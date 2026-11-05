import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGO_ATLUS_DB_URI);

let booksCollection;
let borrowsCollection;

export async function connectToMongoDB() {
    try {
        await client.connect();
        const myDB = client.db("booknook");
        booksCollection = myDB.collection("books");
        borrowsCollection = myDB.collection("borrows");
        console.log("Successfully connected to MongoDB!");
    } catch (err) {
        console.error("MongoDB Connection Failed:", err);
        process.exit(1);
    }
}

app.get('/', (req, res) => {
    res.send('BookNook Server is Running');
});

app.get('/my-books/:userEmail', async (req, res) => {
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

// DELETE /book/:id - Delete a book from the shelf
app.delete('/book/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        msg: 'Invalid book ID format',
        error: true,
      });
    }

    const bookObjectId = new ObjectId(id);

    // Prevent deletion if copies are actively borrowed
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

app.get('/my-borrows/:userEmail', async (req, res) => {
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
            status: 'borrowed', // Only active borrows
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
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $sort: { returnDueDate: 1 }, // Nearest due date first
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

app.put('/edit-book/:id', async (req, res) => {
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

// POST /return-book - Mark status as returned and increment available stock
app.post('/return-book', async (req, res) => {
  try {
    const { borrowId } = req.body;

    if (!borrowId || !ObjectId.isValid(borrowId)) {
      return res.status(400).send({
        msg: 'Valid borrow ID is required',
        error: true,
      });
    }

    const borrowObjectId = new ObjectId(borrowId);

    // 1. Locate the active borrow record
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

    // 2. Mark borrow record as returned
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

    // 3. Return the stock count back to the shelf (+1)
    await booksCollection.updateOne(
      { _id: borrow.bookId },
      { $inc: { totalCopies: 1 } }
    );

    res.send({
      msg: 'Book returned successfully! Thank you for sharing with the community.',
      error: false,
    });
  } catch (error) {
    res.status(500).send({
      msg: 'MongoDB error: ' + error.message,
      error: true,
    });
  }
});

// Fetch all books
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

// Fetch latest books with limit
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

// Fetch single book by ID
app.get('/book/:id', async (req, res) => {
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

// Add a new book
app.post('/add-book', async (req, res) => {
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

// Process borrow request
app.post("/add-borrow", async (req, res) => {
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

        // Convert string to Date instance or fallback to +14 days
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
            msg: `"${book.title}" borrowed successfully! Return by ${parsedReturnDate.toLocaleDateString("en-GB")}.`,
            error: false,
            data: {
                borrowId: result.insertedId,
                returnDueDate: parsedReturnDate.toISOString(),
            },
        });
    } catch (error) {
        res.status(500).send({
            msg: "MongoDB error: " + error.message,
            error: true,
        });
    }
});

connectToMongoDB().then(() => {
    app.listen(port, () => {
        console.log(`Server running on port ${port}`);
    });
});