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


app.get('/borrow-status/:bookId/:userEmail', verifyToken, async (req, res) => {
  try {
    const { bookId, userEmail } = req.params;

    if (!bookId || !ObjectId.isValid(bookId)) {
      return res.status(400).send({
        msg: 'Invalid book ID format',
        error: true,
        hasBorrowed: false,
      });
    }

    if (!userEmail) {
      return res.status(400).send({
        msg: 'User email is required',
        error: true,
        hasBorrowed: false,
      });
    }

    const borrowRecord = await borrowsCollection.findOne({
      bookId: new ObjectId(bookId),
      userEmail,
      status: 'borrowed',
    });

    res.send({
      msg: 'Borrow status checked successfully',
      error: false,
      hasBorrowed: Boolean(borrowRecord),
    });
  } catch (error) {
    res.status(500).send({
      msg: 'MongoDB error: ' + error.message,
      error: true,
      hasBorrowed: false,
    });
  }
});


app.get('/', (req, res) => {
  res.send('BookNook Server is Running');
});

app.get('/my-books/:userEmail', verifyToken, async (req, res) => {
  try {
    const { userEmail } = req.params;

    if (!userEmail) {
      return res.status(400).send({
        msg: 'User email is required',
        error: true,
        data: [],
      });
    }

    const books = await booksCollection
      .find({ userEmail })
      .sort({ createdAt: -1 })
      .toArray();

    res.send({
      msg: 'User books fetched successfully',
      error: false,
      data: books,
    });
  } catch (error) {
    res.status(500).send({
      msg: 'MongoDB error: ' + error.message,
      error: true,
      data: [],
    });
  }
});


app.delete('/book/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        msg: 'Invalid book ID format',
        error: true,
      });
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
      return res.status(404).send({
        msg: 'Book not found or already deleted',
        error: true,
      });
    }

    res.send({
      msg: 'Book removed from shelf successfully',
      error: false,
    });
  } catch (error) {
    res.status(500).send({
      msg: 'MongoDB error: ' + error.message,
      error: true,
    });
  }
});


app.get('/my-borrows/:userEmail', verifyToken, async (req, res) => {
  try {
    const { userEmail } = req.params;

    if (!userEmail) {
      return res.status(400).send({
        msg: 'User email is required',
        error: true,
        data: [],
      });
    }
    const borrows = await borrowsCollection
      .aggregate([
        {
          $match: {
            userEmail,
            status: 'borrowed',
          },
        },
        {
          $lookup: {
            from: 'books',
            localField: 'bookId',
            foreignField: '_id',
            as: 'bookDetails',
          },
        },
        {
          $unwind: {
            path: '$bookDetails',
            // preserveNullAndEmptyArrays: true,
          },
        },
        {
          $sort: { returnDueDate: 1 },
        },
      ])
      .toArray();

    res.send({
      msg: 'Borrowed books fetched successfully',
      error: false,
      data: borrows,
    });
  } catch (error) {
    res.status(500).send({
      msg: 'MongoDB error: ' + error.message,
      error: true,
      data: [],
    });
  }
});

app.put('/edit-book/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, authorName, category, image, shortDescription } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        msg: 'Invalid book ID format',
        error: true,
      });
    }

    if (!title || !authorName || !category || !image || !shortDescription) {
      return res.status(400).send({
        msg: 'Please provide all required book details',
        error: true,
      });
    }

    const updateDoc = {
      $set: {
        title: title.trim(),
        authorName: authorName.trim(),
        category,
        image,
        shortDescription: shortDescription.trim(),
        updatedAt: new Date(),
      },
    };

    const result = await booksCollection.updateOne(
      { _id: new ObjectId(id) },
      updateDoc
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        msg: 'Book not found',
        error: true,
      });
    }

    res.send({
      msg: 'Book details updated successfully!',
      error: false,
    });
  } catch (error) {
    res.status(500).send({
      msg: 'MongoDB error: ' + error.message,
      error: true,
    });
  }
});

app.post('/return-book', verifyToken, async (req, res) => {
  try {
    const { borrowId } = req.body;

    if (!borrowId || !ObjectId.isValid(borrowId)) {
      return res.status(400).send({
        msg: 'Valid borrow ID is required',
        error: true,
      });
    }

    const borrowObjectId = new ObjectId(borrowId);

    const borrow = await borrowsCollection.findOne({
      _id: borrowObjectId,
      status: 'borrowed',
    });

    if (!borrow) {
      return res.status(404).send({
        msg: 'Active borrow record not found or already returned',
        error: true,
      });
    }

    const updateBorrow = await borrowsCollection.updateOne(
      { _id: borrowObjectId },
      {
        $set: {
          status: 'returned',
          returnedAt: new Date(),
        },
      }
    );

    if (!updateBorrow.acknowledged) {
      return res.status(500).send({
        msg: 'Failed to update borrow record',
        error: true,
      });
    }
    await booksCollection.updateOne(
      { _id: borrow.bookId },
      { $inc: { totalCopies: 1 } }
    );

    res.send({
      msg: `Book returned successfully`,
      error: false,
    });
  } catch (error) {
    res.status(500).send({
      msg: 'MongoDB error: ' + error.message,
      error: true,
    });
  }
});

app.get('/all-books', async (req, res) => {
  try {
    const books = await booksCollection.find({}).sort({ createdAt: -1 }).toArray();
    res.send({
      msg: 'Books fetched successfully',
      error: false,
      data: books,
    });
  } catch (error) {
    res.status(500).send({
      msg: 'MongoDB error: ' + error.message,
      error: true,
      data: [],
    });
  }
});

app.get('/newBooks/:limit', async (req, res) => {
  const limit = parseInt(req.params.limit) || 6;
  try {
    const books = await booksCollection.find({}).limit(limit).sort({ createdAt: -1 }).toArray();
    res.send({
      msg: 'Books fetched successfully',
      error: false,
      data: books,
    });
  } catch (error) {
    res.status(500).send({
      msg: 'MongoDB error: ' + error.message,
      error: true,
      data: [],
    });
  }
});

app.get('/book/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).send({
      msg: 'Invalid book ID format',
      error: true,
      data: null,
    });
  }
  try {
    const book = await booksCollection.findOne({ _id: new ObjectId(id) });
    if (!book) {
      return res.status(404).send({
        msg: 'Book not found',
        error: true,
        data: null,
      });
    }

    res.send({
      msg: 'Book fetched successfully',
      error: false,
      data: book,
    });
  } catch (error) {
    res.status(500).send({
      msg: 'MongoDB error: ' + error.message,
      error: true,
      data: null,
    });
  }
});

app.post('/add-book', verifyToken, async (req, res) => {
  try {
    const bookData = {
      ...req.body,
      createdAt: new Date(),
    };

    const result = await booksCollection.insertOne(bookData);

    if (result.acknowledged) {
      res.status(201).send({ msg: 'Book added successfully', error: false });
    } else {
      res.status(500).send({ msg: 'Failed to insert book', error: true });
    }
  } catch (error) {
    res.status(500).send({ msg: 'MongoDB error: ' + error.message, error: true });
  }
});

app.post("/add-borrow", verifyToken, async (req, res) => {
  try {
    const { bookId, userEmail, userName, returnDueDate } = req.body;

    if (!bookId || !ObjectId.isValid(bookId)) {
      return res.status(400).send({
        msg: "Valid Book ID is required",
        error: true,
      });
    }

    if (!userEmail) {
      return res.status(400).send({
        msg: "User email is required",
        error: true,
      });
    }

    const parsedReturnDate = returnDueDate
      ? new Date(returnDueDate)
      : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    if (isNaN(parsedReturnDate.getTime())) {
      return res.status(400).send({
        msg: "Invalid return date provided",
        error: true,
      });
    }

    const bookObjectId = new ObjectId(bookId);

    const book = await booksCollection.findOne({ _id: bookObjectId });
    if (!book) {
      return res.status(404).send({
        msg: "Book not found",
        error: true,
      });
    }

    if (book.totalCopies <= 0) {
      return res.status(400).send({
        msg: "Sorry, no copies of this book are currently available",
        error: true,
      });
    }

    const existingBorrow = await borrowsCollection.findOne({
      bookId: bookObjectId,
      userEmail,
      status: "borrowed",
    });

    if (existingBorrow) {
      return res.status(400).send({
        msg: "You already have an active borrow for this book",
        error: true,
      });
    }

    const borrowRecord = {
      bookId: bookObjectId,
      bookTitle: book.title,
      bookImage: book.image,
      authorName: book.authorName,
      category: book.category,
      userEmail,
      userName: userName || "Community Reader",
      borrowedAt: new Date(),
      returnDueDate: parsedReturnDate,
      status: "borrowed",
    };

    const result = await borrowsCollection.insertOne(borrowRecord);

    if (!result.acknowledged) {
      return res.status(500).send({
        msg: "Failed to record borrow request",
        error: true,
      });
    }

    await booksCollection.updateOne(
      { _id: bookObjectId },
      { $inc: { totalCopies: -1 } }
    );

    res.status(201).send({
      msg: `${book.title} borrowed successfully!
Return: ${parsedReturnDate.toLocaleDateString("en-GB")}`,
      error: false,
    });
  } catch (error) {
    res.status(500).send({
      msg: "MongoDB error: " + error.message,
      error: true,
    });
  }
});


app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});


export default app;