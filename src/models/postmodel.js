import { Timestamp } from 'mongodb';
import mongoose from 'mongoose';

const { Schema } = mongoose;

const { ObjectId } = mongoose.Schema.Types;


const commentSchema = new Schema({
    userName: { type: String, required: true },
    body: { type: String, required: true },
    date: { type: Date, default: Date.now },
    likes: { type: Number, default: 0 },
    commentLikeIds: [{ type: String }],
    id: { type: String, required: true },
    userId: { type: String, required: true }
});

const postSchema = new Schema({
    userId: String,
    body: String,
    comments: [commentSchema],
    imageId: String,
    date: { type: Date },
    likes: { type: Number, default: 0 },
    likedIds: [{ type: String }], // when a user likes a post their id is added to that post
    likeNames: [{ type: String }], // when a user likes a post their username is added to that post
    userName: { type: String, required: true },
}, { timestamps: true })

const Post = mongoose.model('Post', postSchema)

export default Post