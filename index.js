import express from 'express';
import cors from 'cors'
import 'dotenv/config'
import { MongoClient } from 'mongodb';

const app = express();
const port = 5000;

app.use(cors());
app.use(express.json());


const client = new MongoClient(process.env.MONGO_ATLUS_DB_URI);


export async function connectToMongoDB() {
    try {
        await client.connect();
        console.log("You successfully connected to MongoDB!");
        return client;
    } catch (err) {
        console.dir(err);
    }
}

export async function disconnectFromMongoDB() {
    await client.close();
}

const myDB = client.db("booknook");
const booksCollection = myDB.collection("books");




app.get('/', (req, res) => {
    res.send('Hello World!');
});


app.get('/books', async (req, res) => {
    try {
        const books = await booksCollection.find({}).toArray();
        res.send({
            msg: 'Books fetched successfully',
            error: false,
            data: books,
        });
    } catch (error) {
        res.send({
            msg: 'MongoDB error: ' + error.message,
            error: true,
            data: [],
        });
    }
});

app.get('/newBooks/:limit', async (req, res) => {
    const limit = req.params.limit
    try {
        const books = await booksCollection.find({}).toArray();
        res.send({
            msg: 'Books fetched successfully',
            error: false,
            data: books,
        });
    } catch (error) {
        res.send({
            msg: 'MongoDB error: ' + error.message,
            error: true,
            data: [],
        });
    }
});

app.post('/add-book', async (req, res) => {
    try {
        const bookData = {
            ...req.body,
            createdAt: new Date(),
        };

        const result = await booksCollection.insertOne(bookData);

        if (result.acknowledged) {
            res.send({ msg: 'Book added successfully', error: false });
        } else {
            res.send({ msg: 'Failed to insert book', error: true });
        }
    } catch (error) {
        res.send({ msg: 'MongoDB error: ' + error.message, error: true });
    }
});


app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});