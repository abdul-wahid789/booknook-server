import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';
import { createRemoteJWKSet, jwtVerify } from 'jose';

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


const myDB = client.db("booknook");
const booksCollection = myDB.collection("books");
const borrowsCollection = myDB.collection("borrows");

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).send({ msg: 'Unauthorized', error: true });

  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).send({ msg: 'Unauthorized', error: true });

  try {
    const JWKS = createRemoteJWKSet(new URL(process.env.CLIENT_URL + '/api/auth/jwks'));
    const { payload } = await jwtVerify(token, JWKS);
    if (payload) {
      req.user = payload;
      return next();
    }
    return res.status(401).send({ msg: 'Unauthorized', error: true });
  } catch (err) {
    return res.status(401).send({ msg: 'Unauthorized: Invalid token', error: true });
  }
};


app.get('/', (req, res) => {
  res.send('BookNook Server is Running');
});

// all books / limit
app.get('/books', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit);
    const books = await booksCollection.find({}).limit(limit).sort({ createdAt: -1 }).toArray();

    res.send({ msg: 'Books fetched successfully', error: false, data: books });
  } catch (error) {
    res.status(500).send({ msg: 'MongoDB error: ' + error.message, error: true, data: [] });
  }
});

// /books/user/:userEmail
app.get('/books/user/:userEmail', verifyToken, async (req, res) => {
  try {
    const { userEmail } = req.params;
    const books = await booksCollection
      .find({ userEmail })
      .sort({ createdAt: -1 })
      .toArray();

    res.send({ msg: 'User books fetched successfully', error: false, data: books });
  } catch (error) {
    res.status(500).send({ msg: 'MongoDB error: ' + error.message, error: true, data: [] });
  }
});

// /books/:id
app.get('/books/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ msg: 'Invalid book ID format', error: true, data: null });
  }
  try {
    const book = await booksCollection.findOne({ _id: new ObjectId(id) });
    if (!book) {
      return res.status(404).send({ msg: 'Book not found', error: true, data: null });
    }
    res.send({ msg: 'Book fetched successfully', error: false, data: book });
  } catch (error) {
    res.status(500).send({ msg: 'MongoDB error: ' + error.message, error: true, data: null });
  }
});

// /books
app.post('/books', verifyToken, async (req, res) => {
  try {
    const bookData = {
      ...req.body,
      createdAt: new Date(),
    };
    const result = await booksCollection.insertOne(bookData);
    if (result.acknowledged) {
      res.status(201).send({ msg: 'Book added successfully', error: false, data: result.insertedId });
    } else {
      res.status(500).send({ msg: 'Failed to insert book', error: true });
    }
  } catch (error) {
    res.status(500).send({ msg: 'MongoDB error: ' + error.message, error: true });
  }
});

// /books/:id
app.put('/books/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, authorName, category, image, shortDescription } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ msg: 'Invalid book ID format', error: true });
    }

    const updateDoc = {
      $set: {
        title: title?.trim(),
        authorName: authorName?.trim(),
        category,
        image,
        shortDescription: shortDescription?.trim(),
        updatedAt: new Date(),
      },
    };

    const result = await booksCollection.updateOne({ _id: new ObjectId(id) }, updateDoc);
    if (result.matchedCount === 0) {
      return res.status(404).send({ msg: 'Book not found', error: true });
    }

    res.send({ msg: 'Book details updated successfully!', error: false });
  } catch (error) {
    res.status(500).send({ msg: 'MongoDB error: ' + error.message, error: true });
  }
});

// /books/:id
app.delete('/books/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ msg: 'Invalid book ID format', error: true });
    }

    const bookObjectId = new ObjectId(id);
    const activeBorrow = await borrowsCollection.findOne({
      bookId: bookObjectId,
      status: 'borrowed',
    });

    if (activeBorrow) {
      return res.status(400).send({
        msg: 'Cannot delete this book while a copy is currently borrowed by a reader.',
        error: true,
      });
    }

    const result = await booksCollection.deleteOne({ _id: bookObjectId });
    if (result.deletedCount === 0) {
      return res.status(404).send({ msg: 'Book not found or already deleted', error: true });
    }

    res.send({ msg: 'Book removed from shelf successfully', error: false });
  } catch (error) {
    res.status(500).send({ msg: 'MongoDB error: ' + error.message, error: true });
  }
});

//  /borrows/check/:bookId/:userEmail
app.get('/borrows/check/:bookId/:userEmail', verifyToken, async (req, res) => {
  try {
    const { bookId, userEmail } = req.params;
    if (!ObjectId.isValid(bookId) || !userEmail) {
      return res.status(400).send({ msg: 'Invalid parameters', error: true, hasBorrowed: false });
    }

    const record = await borrowsCollection.findOne({
      bookId: new ObjectId(bookId),
      userEmail,
      status: 'borrowed',
    });

    res.send({ msg: 'Status checked', error: false, data: Boolean(record) });
  } catch (error) {
    res.status(500).send({ msg: error.message, error: true, hasBorrowed: false });
  }
});

// /borrows/user/:userEmail
app.get('/borrows/user/:userEmail', verifyToken, async (req, res) => {
  try {
    const { userEmail } = req.params;
    const borrows = await borrowsCollection
      .aggregate([
        { $match: { userEmail, status: 'borrowed' } },
        {
          $lookup: {
            from: 'books',
            localField: 'bookId',
            foreignField: '_id',
            as: 'bookDetails',
          },
        },
        { $unwind: '$bookDetails' },
        { $sort: { returnDueDate: 1 } },
      ])
      .toArray();

    res.send({ msg: 'Borrowed books fetched', error: false, data: borrows });
  } catch (error) {
    res.status(500).send({ msg: error.message, error: true, data: [] });
  }
});

// borrows
app.post('/borrows', verifyToken, async (req, res) => {
  try {
    const { bookId, userEmail, userName, returnDueDate } = req.body;
    if (!ObjectId.isValid(bookId) || !userEmail) {
      return res.status(400).send({ msg: 'Valid Book ID and user email are required', error: true });
    }

    const bookObjectId = new ObjectId(bookId);
    const book = await booksCollection.findOne({ _id: bookObjectId });
    if (!book) return res.status(404).send({ msg: 'Book not found', error: true });
    if (book.totalCopies <= 0) return res.status(400).send({ msg: 'No copies available', error: true });

    const existing = await borrowsCollection.findOne({ bookId: bookObjectId, userEmail, status: 'borrowed' });
    if (existing) return res.status(400).send({ msg: 'Book is already borrowed by you', error: true });

    const parsedReturnDate = returnDueDate
      ? new Date(returnDueDate)
      : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    const borrowRecord = {
      bookId: bookObjectId,
      bookTitle: book.title,
      bookImage: book.image,
      authorName: book.authorName,
      category: book.category,
      userEmail,
      userName: userName || 'Community Reader',
      borrowedAt: new Date(),
      returnDueDate: parsedReturnDate,
      status: 'borrowed',
    };

    await borrowsCollection.insertOne(borrowRecord);
    await booksCollection.updateOne({ _id: bookObjectId }, { $inc: { totalCopies: -1 } });

    res.status(201).send({ msg: 'Book borrowed successfully', error: false });
  } catch (error) {
    res.status(500).send({ msg: error.message, error: true });
  }
});

// POST /borrows/return
app.post('/borrows/return/:borrowId', verifyToken, async (req, res) => {
  try {
    const { borrowId } = req.params;
    if (!ObjectId.isValid(borrowId)) {
      return res.status(400).send({ msg: 'Valid borrow ID is required', error: true });
    }
    const borrowObjectId = new ObjectId(borrowId);
    const borrow = await borrowsCollection.findOne({ _id: borrowObjectId, status: 'borrowed' });
    if (!borrow) return res.status(404).send({ msg: 'Active borrow record not found', error: true });

    await borrowsCollection.updateOne(
      { _id: borrowObjectId },
      { $set: { status: 'returned', returnedAt: new Date() } }
    );
    await booksCollection.updateOne({ _id: borrow.bookId }, { $inc: { totalCopies: 1 } });

    res.send({ msg: 'Book returned successfully', error: false });
  } catch (error) {
    res.status(500).send({ msg: error.message, error: true });
  }
});


app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});


export default app;