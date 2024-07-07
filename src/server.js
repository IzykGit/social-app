

import express from 'express'
import bodyParser from 'body-parser'

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, $Command } from '@aws-sdk/client-s3';
import multer from 'multer';
// import stream from 'stream';

import path from 'path';

import { fileURLToPath } from 'url';

import cors from 'cors';



import 'dotenv/config'

import fs from 'fs';
import admin from 'firebase-admin'



const credentials = JSON.parse(
    fs.readFileSync('./credentials.json')
)


admin.initializeApp({
    credential: admin.credential.cert(credentials)
})



const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename)

const app = express();
app.use(express());
app.use(bodyParser.json())
app.use(cors());

app.use(express.static(path.join(__dirname, "../dist")))

import mongoose, { Types } from 'mongoose';
import { MongoClient, ObjectId } from 'mongodb';


import Post from './models/postmodel.js';

// AWS Credentials
const s3Client = new S3Client({
    region: 'us-east-1',
    credentials: {
      accessKeyId: process.env.ACCESS_KEY,
      secretAccessKey: process.env.SECRET_KEY,
    },
    endpoint: 'https://us-east-1.linodeobjects.com',
});


const storage = multer.memoryStorage();
const upload = multer({ storage: storage });





app.get(/^(?!\/api).+/, (req, res) => {
    res.sendFile(path.join(__dirname, "../dist/index.html"))
})




// verifying the authtoken
app.use(async (req, res, next) => {

    const authHeader = req.headers.authorization



    if(authHeader) {
        const token = authHeader.split(" ")[1];

        try {
            req.user = await admin.auth().verifyIdToken(token)
        }
        catch (e) {
            console.log("Invalid authtoken", e)
            return res.status(400).json(e)
        }
    }
    else {
        req.user = {}
    }

    next();
})














// // sorting posts by newest first
// const sortedData = response.data.posts.sort((a: Data, b: Data) => new Date(b.date).getTime() - new Date(a.date).getTime());

// fetching all posts from database
app.get("/api/home", async (req, res) => {
    const client = new MongoClient(process.env.MONGODB_URI)


    try {
        const page = parseInt(req.query.page) || 1
        const limit = parseInt(req.query.limit) || 10
        const skip = (page - 1) * limit;

        await client.connect();

        const db = client.db('SocialApp')
        const postCollection = db.collection('posts')

        const posts = await postCollection.find({}).sort({ date: -1 })
        .skip(skip).limit(limit).toArray();

        const totalPosts = await postCollection.countDocuments()

        
        res.json({
            posts,
            totalPosts,
            totalPages: Math.ceil(totalPosts / limit),
            currentPage: page
        });
    }
    catch (err) {
        console.error("Error connecting to database", err)
    }
    finally {
        await client.close()
    }
});

// fetching post images

app.get("/api/home/:imageId", async (req, res) => {
    const imageId = req.params.imageId

    const params = {
        Bucket: process.env.BUCKET_NAME,
        Key: imageId,
    };

    try {
        const data = await s3Client.send(new GetObjectCommand(params));
        if (data.Body) {
          const chunks = [];
          data.Body.on('data', (chunk) => chunks.push(chunk));
          data.Body.on('end', () => {
            const buffer = Buffer.concat(chunks);
            const base64 = buffer.toString('base64');
            res.json({ image: base64 });
          });
        } else {
          res.status(404).json({ message: 'Image not found' });
        }
      } catch (error) {
        console.error('S3 fetch error:', error);
        res.status(500).json({ message: error.message });
      }
})


//fetching specific post form database

app.get("/api/post/:id", async (req, res) => {
    const client = new MongoClient(process.env.MONGODB_URI)

    const postId = new Types.ObjectId(req.params.id);

    const { uid } = req.user;

    try {
        await client.connect();

        const db = client.db("SocialApp");
        const post = await db.collection('posts').findOne({ _id: postId });

        if(post) {
            const likedIds = post.upvoteIds || [];
            post.canLike = uid && !likedIds.includes(uid)
            res.json(post)
        }

    }
    catch (error) {
        console.error("Error retrieving post:", error)
        res.status(404).json({ message: "Error"})
    }
    finally {
        await client.close()
    }
})




// post creation page
app.post("/api/post", upload.single('file'), async (req, res) => {
    const client = new MongoClient(process.env.MONGODB_URI);

    try {

    await client.connect();
    const db = client.db('SocialApp');
    
        // handling post to s3
        if (req.file) {
        
        const params = {
          Bucket: process.env.BUCKET_NAME,

          // setting key to random generated image Id
          Key: req.body.imageId,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
        };
        
        
        try {

            // post image is sent to s3 bucket
            await s3Client.send(new PutObjectCommand(params));
        } catch (error) {
          console.error('S3 upload error:', error);
        }
        } else {
            console.log('No file found in the request');
        }

        const userInfo = await db.collection('users').findOne({ userId: req.user.uid })
        console.log("Username from userinfo:", userInfo.userName)

        const newPostData = {
            ...req.body,
            imageId: req.body.imageId, // save the generated image ID in the post data
            userName: userInfo.userName
        };

        

        // handling post to mongodb

        const newPost = new Post(newPostData);
        const insertedPost = await db.collection('posts').insertOne(newPost);

        console.log("Inserted Post Id:", insertedPost.insertedId)

        await db.collection("notifications").updateOne(
            { userId: req.user.uid },
            {
                // adding user and post data to notifications array
                $push: { notifications:
                    {
                        userNames: [],
                        postId: insertedPost.insertedId,
                        postBody: req.body.body
                    }
                }
            }
        )
  
        res.status(201).json(newPost);
    }
    catch (err) {
      console.error('Post creation failed:', err);
      res.status(500).json({ message: `Post Failed: ${err}` });
    }
    finally {
      await client.close();
    }
  });



















app.get("/api/user-check/:username", async (req, res) => {
    const client = new MongoClient(process.env.MONGODB_URI)


    try {
        await client.connect()
        const db = client.db('SocialApp');

        const user = await db.collection('users').findOne({ userName: req.params })
        console.log(user)

        if(user) {
            res.status(400).json({ exists: true })
        }

        res.status(200).json({ exists: false})
    }
    catch (error) {
        res.status(400).json({ message: "Username already exists" })
    }
})






app.post("/api/create-user", async (req, res) => {
    const client = new MongoClient(process.env.MONGODB_URI);

    const newUser = {
        userName: req.body.userName,
        userId: req.body.userId,
        userEmail: req.body.userEmail,
        date: req.body.date
    };

    const newNotificationsDoc = {
        userId: req.body.userId,
        notifications: []
    }

    try { 
        await client.connect()
        const db = client.db('SocialApp');
        await db.collection('users').insertOne(newUser);

        await db.collection('notifications').insertOne(newNotificationsDoc)

        res.status(201).send("User added to MongoDB")
    }
    catch (error) {
    console.error('Error adding user to MongoDB:', error);
    res.status(500).send('Internal server error');
    } finally {
    await client.close();
    }
})



















app.get("/api/profile", async (req, res) => {
    const client = new MongoClient(process.env.MONGODB_URI)

    try {
        await client.connect();
        const db = client.db("SocialApp");

        const posts = await db.collection('posts').find({ userId: req.user.uid })
        .sort({ date: -1 }).toArray();

        const user = await db.collection('users').findOne({ userId: req.user.uid })

        res.status(200).json({posts, user})

    }
    catch (error) {
        res.status(400).json({ message: "Error to find posts" })
    }
    finally {
        await client.close()
    }
})

app.get("/api/profile/:imageId", async (req, res) => {
    const imageId = req.params.imageId

    const params = {
        Bucket: process.env.BUCKET_NAME,
        Key: imageId,
    };

    try {
        const data = await s3Client.send(new GetObjectCommand(params));
        if (data.Body) {
          const chunks = [];
          data.Body.on('data', (chunk) => chunks.push(chunk));
          data.Body.on('end', () => {
            const buffer = Buffer.concat(chunks);
            const base64 = buffer.toString('base64');
            return res.json({ image: base64 });
          });
        } else {
          return res.status(404).json({ message: 'Image not found' });
        }
      } catch (error) {
        console.error('S3 fetch error:', error);
        return res.status(500).json({ message: error.message });
      }
})


app.get("/api/profile-visitor/:userName", async (req, res) => {
    const client = new MongoClient(process.env.MONGODB_URI)

    try {
        await client.connect();
        const db = client.db("SocialApp")

        const posts = await db.collection('posts').find({ userName: req.params.userName })
        .sort({ date: -1 }).toArray();

        if(!posts) {
            return res.status(400).json({ message: "No Posts Exist" })
        }

        res.status(200).json(posts)
    }
    catch (error) {
        res.status(400).json({ message: "Error fetching posts" })
    }
    finally {
        await client.close()
    }
})

















app.use((req, res, next) => {

    if (req.user) {
        next()
    }
    else {
        res.sendStatus(401)
    }
})



app.put('/api/:postId/like', async (req, res) => {
    // getting mongoclient
    const client = new MongoClient(process.env.MONGODB_URI)

    // getting post id and user id
    const postId = req.params.postId;
    const userId = req.user.uid

    console.log("Post ID is:", postId)
    console.log("userId:", userId)


    try {

        // conecting to client and database
        await client.connect()
        const db = client.db('SocialApp');
        

        // fetching original post
        const post = await db.collection('posts').findOne({ _id: new ObjectId(postId) })
        console.log(post)
        
        if (!post) {
            return res.status(404).json({ message: "Post not found" });
        }

        const likedIds = post.likedIds || [];
        console.log(`Liked IDs: ${likedIds}`)

        const canLike = userId && !likedIds.includes(userId)
        console.log(`Can like`)

        // checking if post exists
        if(canLike) {

            console.log("In like request")

            const likersName = await db.collection("users").findOne(
                { userId: userId },
                { projection: { userName: 1 } }
            )
            console.log("Likers username:", likersName)

            await db.collection("posts").findOneAndUpdate(
                { _id: new ObjectId(postId) },
                { 
                    // incrementing likes by one
                    $inc: { likes: 1 },
                    // adding user id to the likeIds array of the post
                    // adding username to the likeNames array of the post
                    $push: { likedIds: userId, likeNames: likersName.userName },
                    // setting new like date
                    $currentDate: { updatedAt: true },
                }
            )


            // updated post
            const updatedPost = await db.collection('posts').findOne(
                { _id: new ObjectId(postId) },
                { projection: { likes: 1, _id: 0 } }
            )


            // checking if updated post exists
            if(updatedPost) {

                // returning status and updated post
                return res.status(200).json({ likes: updatedPost.likes })

            }
            else {
                return res.status(400).json({ message: "Like Failed" })
            }

        }
    }
    catch (error) {
        console.log("like failed")
        console.error(error.message)
    }
    finally {
        await client.close()
    }

})




app.put('/api/:postId/unlike', async (req, res) => {
    const client = new MongoClient(process.env.MONGODB_URI)
    const postId = req.params.postId;
    const userId = req.user.uid

    console.log(userId)

    console.log("attempting to unlike")
    try {
        await client.connect()
        const db = client.db('SocialApp');
    
        const originalPost = await db.collection('posts').findOne({ _id: new ObjectId(postId) })
        
        if(!originalPost) {
            return res.status(400).json({ message: "No Post" })
        }

        const likedIds = originalPost.likedIds || [];
        console.log(`Liked IDs: ${likedIds}`)

        const canUnLike = userId && likedIds.includes(userId)
        console.log(`Can Unlike: ${canUnLike}`);
        
        // removing like and userId from likedIds array
        if(canUnLike) {

            const likersName = await db.collection("users").findOne(
                { userId: userId },
                { projection: { userName: 1 } }
            )
            console.log("Likers username:", likersName)

                console.log("can unlike")
                await db.collection("posts").updateOne(
                    { _id: new ObjectId(postId) },
                    {   
                        // removing one like
                        $inc: { likes: -1 },
                        // removing the userId from the likedIds array
                        // removing the username from the likeNames array
                        $pull: { likedIds: userId, likeNames: likersName.userName },
                    }
                )

        }
        const updatedPost = await db.collection('posts').findOne(
            { _id: new ObjectId(postId) },
            { projection: {likes: 1} }
        )

        if(updatedPost) {
            console.log("unlike made")
            return res.status(200).json(updatedPost)
        }
        else {
            return res.status(500).json({ message: "Failed to update post" })
        }

    }
    catch (error) {
        console.log("like failed")
        console.error(error.message)
    }
    finally {
        await client.close()
    } 

})

























// fetching new comment after a comment is posted

app.get('/api/post/:postId/comment', async (req, res) => {
    const client = new MongoClient(process.env.MONGODB_URI)

    const postId = req.params;

    try {
        await client.connect()
        const db = client.db('SocialApp');

        const post = await db.collection('posts').findOne({ _id: postId})

        res.json(post.comments)
    }
    catch (error) {
        res.status(500).json({ message: "Failed to make comment" })
    }
    finally {
        await client.close()
    }
})


// posting a new comment

app.post('/api/posts/:postId/comment', async (req, res) => {
    const client = new MongoClient(process.env.MONGODB_URI)
    const { postId } = req.params
    const { body, date } = req.body;


    console.log("Attempting to comment")


     try {
        await client.connect()
        const db = client.db('SocialApp')
        
        const user = await db.collection('users').findOne({ userId: req.user.uid })

        const post = await db.collection('posts').updateOne({ _id: new ObjectId(postId) }, {
            $push: { comments: {
                body,
                date: new Date(date),
                userName: user.userName,
                id: new ObjectId(),
                userId: req.user.uid,
                likes: 0,
                commentLikeIds: []
            }} 
        })

        console.log("Comment Made")
        res.status(200).json(post)
    }
    catch (error) {
            console.log(error)
            res.status(500).json({ message: "Error:", error })
    } 
    finally {
        await client.close();
    }
})



app.delete('/api/:post/:commentId/comment/delete', async (req, res) => {
    const client = new MongoClient(process.env.MONGODB_URI);

    const commentId = req.params.commentId;
    const postId = req.params.post;

    console.log("Post Identifier:", postId);
    console.log("Comment Identifier:", commentId);

    console.log("Attempting to del comment");

    try {
        await client.connect();
        const db = client.db("SocialApp");

        console.log("Connected to database");

        const result = await db.collection('posts').updateOne(
            { _id: new ObjectId(postId) },
            { $pull: { "comments": { id: new ObjectId(commentId) } }}
        );

        return res.status(200).json({ message: "comment deleted", result });
    }
    catch(error) {
        return res.status(400).json(error);
    }
    finally {
        await client.close();
    }
})


















app.get('/api/user-notifications', async (req, res) => {
    const client = new MongoClient(process.env.MONGODB_URI);

    const userId = req.user.uid
    console.log(userId)

    const todaysDate = new Date()
    const lastFifteenDays = new Date(todaysDate);

    lastFifteenDays.setDate(todaysDate.getDate() - 15);

    const pipeline = [
        { $match: { userId: userId } },
        { $project: {
            body: 1,
            likeNames: 1,
            likeNamesCount: { $size: "$likeNames" }
        } },
        { $unwind: "$likeNames" },
        { $sort: { "likeNames.date": -1 } }, // Sort by the date field in descending order
        { $group: {
            _id: "$_id",
            body: { $first: "$body" },
            likeNames: { $push: "$likeNames" },
            likeNamesCount: { $first: "$likeNamesCount" }
        }},
        { $project: {
            _id: 1,
            body: 1,
            likeNames: { $slice: ["$likeNames", 2] }, // Get the 2 most recent names
            likeNamesCount: 1
        }}
    ];

    try {
        await client.connect()
        const db = client.db("SocialApp")

        const recentLikes = await db.collection("posts").aggregate(pipeline).toArray();

        console.log(recentLikes)
        res.status(200).json(recentLikes)
    }
    catch(error) {
        res.status(404).json(notifications)
    }
    finally {
        await client.close()
    }
}) 




























app.delete('/api/post/:id/:imageId', async (req, res) => {
    const client = new MongoClient(process.env.MONGODB_URI)
    const imageId = req.params.imageId
    const postId = new Types.ObjectId(req.params.id);

    const params = {
        Bucket: process.env.BUCKET_NAME,
        Key: imageId,
    };

    try {
        await client.connect();
        const db = client.db('SocialApp');

        db.collection("posts").deleteOne({ _id: postId })
        s3Client.send(new DeleteObjectCommand(params))
        console.log("deletion made")
        res.status(200).json({ message: "Post deleted successfully" })
    }
    catch (error) {
        console.error(error)
    }

})




const PORT = process.env.PORT || 5000


mongoose.connect(process.env.MONGODB_URI, {
    dbName: "SocialApp"
}).then(() => {
    app.listen(5000, () => {
        console.log("Connected on PORT")
    })
}).catch(error => {
    console.log(error)
})
