require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const port = process.env.PORT || 3000;
const stripe = require("stripe")(process.env.STIPE_SECRET_KEY);

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf-8"
);
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
// middleware
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      process.env.SITE_DOMAIN,
    ],
    credentials: true,
    optionSuccessStatus: 200,
  })
);
app.use(express.json());

// jwt middleware
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  // console.log(token);
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    // console.log(decoded);
    next();
  } catch (err) {
    console.log(err);
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    const database = client.db("BookCourier");
    const usersCollection = database.collection("users");
    const booksCollection = database.collection("books");
    const ordersCollection = database.collection("orders");
    const wishlistCollection = database.collection("wishlist");
    const invoiceCollection = database.collection("invoice");
    const reviewCollection = database.collection("reviews");

    const checkAdmin = async (req, res, next) => {
      const email = req.tokenEmail;
      if (!email) return res.status(401).send({ message: "Unauthorized" });
      const user = await usersCollection.findOne({ email });
      if (user?.role !== "admin") {
        return res.status(403).send({ message: "Forbidden! Admin only." });
      }
      next();
    };

    const checkLibrarian = async (req, res, next) => {
      const email = req.tokenEmail;
      if (!email) return res.status(401).send({ message: "Unauthorized" });
      const user = await usersCollection.findOne({ email });
      if (user?.role !== "librarian") {
        return res.status(403).send({ message: "Forbidden! Librarian only." });
      }
      next();
    };

    // users apis
    // storing user data when a user get registered
    app.post("/users", async (req, res) => {
      const user = req.body;
      const isExists = await usersCollection.findOne({ email: user.email });
      if (isExists) {
        return res.send({ message: "User already exist" });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // get all the users for admin user-management
    app.get("/users", verifyJWT, checkAdmin, async (req, res) => {
      const email = req.tokenEmail;
      const result = await usersCollection
        .find({ email: { $ne: email } })
        .toArray();
      res.send(result);
    });

    // getting role of a user
    app.get("/user/role", verifyJWT, async (req, res) => {
      const email = req.tokenEmail;
      const result = await usersCollection.findOne({ email: email });
      res.send({ role: result?.role });
    });

    // updating user profile
    app.patch("/users/my-profile/:email", verifyJWT, async (req, res) => {
      const { email } = req.params;
      const { name, photoURL } = req.body;
      const updateInfo = {
        $set: {
          name: name,
          photo: photoURL,
        },
      };
      const result = await usersCollection.updateOne(
        { email: email },
        updateInfo
      );
      res.send(result);
    });

    // updating user role by admin
    app.patch("/update-user/:id", verifyJWT, checkAdmin, async (req, res) => {
      const { id } = req.params;
      const role = req.body.role;
      const filter = { _id: new ObjectId(id) };
      const result = await usersCollection.updateOne(filter, {
        $set: { role: role },
      });
      res.send(result);
    });

    // get a single user for profile page
    app.get("/users/:email", verifyJWT, async (req, res) => {
      const { email } = req.params;
      const result = await usersCollection.findOne({ email });
      res.send(result);
    });

    // books collection APIs
    // saving the books in the database by a librarian.
    app.post("/books", verifyJWT, checkLibrarian, async (req, res) => {
      const email = req.tokenEmail;
      const book = req.body;
      if (email) {
        book.createdBy = email;
        book.createdAt = new Date();
      }
      const result = await booksCollection.insertOne(book);
      res.send(result);
    });

    // get books with search and sort
    app.get("/books", async (req, res) => {
      const search = req.query.search || "";
      const sort = req.query.sort || "";
      const fil = req.query.filter || "";
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;
      let filter = {
        status: "published",
        bookName: { $regex: search, $options: "i" },
      };

      let sortOption = { createdAt: -1 };
      
      if (fil && fil !== "All") {
        filter.category = fil;
      }

      if (sort === "low-to-high") sortOption = { price: 1, createdAt: -1 };
      if (sort === "high-to-low") sortOption = { price: -1, createdAt: -1 };

      const totalBooks = await booksCollection.countDocuments(filter);

      const totalPages = Math.ceil(totalBooks / limit);

      const books = await booksCollection
        .find(filter)
        .sort(sortOption)
        .skip(skip)
        .limit(limit)
        .toArray();

      res.send({
        books,
        totalPages,
      });
    });

  // related books here
  app.get("/related-books/:id", async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ message: "Invalid book id" });
  }

  const book = await booksCollection.findOne({ _id: new ObjectId(id) });

  if (!book) {
    return res.status(404).send({ message: "Book not found" });
  }

  const relatedBooks = await booksCollection
    .find({
      _id: { $ne: new ObjectId(id) }, 
      category: book.category, 
      status: "published",         
    })
    .sort({ createdAt: -1 })
    .limit(4)
    .toArray();

  res.send(relatedBooks);
});


    // getting all-books for admin manage-books
    app.get("/all-books", verifyJWT, checkAdmin, async (req, res) => {
      const result = await booksCollection.find().toArray();
      res.send(result);
    });

    // getting the books of a librarian
    app.get("/my-books", verifyJWT, checkLibrarian, async (req, res) => {
      const email = req.tokenEmail;
      const filter = {};
      if (email) {
        filter.createdBy = email;
      }
      const result = await booksCollection.find(filter).toArray();
      res.send(result);
    });

    // updating the status of a book by librarian and admin
    app.patch("/books/update-status/:id", verifyJWT, async (req, res) => {
      const { id } = req.params;
      const filter = { _id: new ObjectId(id) };
      const status = req.body.status;
      const update = {
        $set: {
          status: status,
        },
      };
      const result = await booksCollection.updateOne(filter, update);
      res.send(result);
    });

    // update a book by book owner(librarian)
    app.patch("/books/update/:id", verifyJWT, checkLibrarian, async (req, res) => {
        const id = req.params.id;
        const updateData = req.body;

        const result = await booksCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );
        res.send(result);
      }
    );

    // getting a single book details
    app.get("/books/:id", async (req, res) => {
      const { id } = req.params;
      const filter = { _id: new ObjectId(id) };
      const result = await booksCollection.findOne(filter);
      // console.log(result)
      res.send(result);
    });

    // getting latest books to display in the home page
    app.get("/latest-books", async (req, res) => {
      const result = await booksCollection
        .find()
        .sort({ createdAt: -1 })
        .limit(8)
        .toArray();
      res.send(result);
    });

    // deleting a book and it's orders by admin
    app.delete("/books/delete/:id", verifyJWT, checkAdmin, async (req, res) => {
      const id = req.params.id;

      const filter = { _id: new ObjectId(id) };

      // Delete book
      const deletedBook = await booksCollection.deleteOne(filter);

      // Also delete orders containing this book
      const deletedOrders = await ordersCollection.deleteMany({ bookId: id });

      res.send(deletedBook);
    });

    // orders collections APIs
    // storing a order from a user
    app.post("/orders", verifyJWT, async (req, res) => {
      const orders = req.body;
      orders.orderStatus = "pending";
      orders.paymentStatus = "unpaid";
      orders.createdAt = new Date();
      orders.transactionId = null;
      const result = await ordersCollection.insertOne(orders);
      res.send(result);
    });

    // getting books published by a librarian
    app.get("/orders/owner", verifyJWT, checkLibrarian, async (req, res) => {
      const email = req.tokenEmail;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;
      const totalOrders = await ordersCollection.countDocuments({ owner: email });
      const totalPages = Math.ceil(totalOrders / limit);
      const result = await ordersCollection.find({ owner: email }).skip(skip).limit(limit).toArray();
      // console.log({totalPages, page, limit, result})
      res.send({result, totalPages});
    });

    // getting users order
    app.get("/my-orders", verifyJWT, async (req, res) => {
      const email = req.tokenEmail;
      // console.log(email)
      const result = await ordersCollection
        .find({ userEmail: email })
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    //  cancelling a order by a librarian
    app.patch("/orders/cancel/:id", verifyJWT, async (req, res) => {
      const { id } = req.params;
      const filter = { _id: new ObjectId(id), orderStatus: "pending" };
      const update = {
        $set: {
          orderStatus: "cancelled",
        },
      };
      const result = await ordersCollection.updateOne(filter, update);
      res.send(result);
    });

    // change the deliveryStatus by a librarian
    app.patch("/orders/status/:id", verifyJWT, checkLibrarian, async (req, res) => {
      const id = req.params.id;
      const status = req.body.status;
      const filter = { _id: new ObjectId(id) };
      const update = {
        $set: {
          orderStatus: status,
        },
      };
      const result = await ordersCollection.updateOne(filter, update);
      res.send(result);
    });

    // GET /orders-stats
    app.get("/orders-stats", verifyJWT, async (req, res) => {
      try {
        const stats = await ordersCollection
          .aggregate([
            {
              $group: {
                _id: { $month: "$createdAt" },
                count: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ])
          .toArray();
        // console.log(stats)
        res.send(stats);
      } catch (error) {
        console.error("Error generating order stats:", error);
        res.status(500).send({ error: "Failed to load order stats" });
      }
    });

    // wishlist apis here
    app.post("/wishlist", verifyJWT, async (req, res) => {
      const wishedBook = req.body;
      // console.log(wishedBook)

      const alreadyWished = await wishlistCollection.findOne({
        userEmail: wishedBook.userEmail,
        bookId: wishedBook.bookId,
      });
      if (alreadyWished) {
        return res.send({ message: "This book already in your wishlist!" });
      }
      const result = await wishlistCollection.insertOne(wishedBook);
      res.send(result);
    });

    // delete wishlist
      app.delete("/wishlist/:id", verifyJWT, async (req, res) => {
        const { id } = req.params;
        const filter = { _id: new ObjectId(id) };
        const result = await wishlistCollection.deleteOne(filter);
        res.send(result);
      });


    // getting the wishlist by a user
    app.get("/my-wishlist/:email", verifyJWT, async (req, res) => {
      const { email } = req.params;
      const filter = { userEmail: email };
      const result = await wishlistCollection.find(filter).toArray();
      res.send(result);
    });

    // payment related APIs
    // sending to stripe checkout
    app.post("/create-checkout-session", verifyJWT, async (req, res) => {
      const paymentInfo = req.body;
      // console.log(paymentInfo)
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: paymentInfo?.price * 100,
              product_data: {
                name: paymentInfo?.bookName,
                images: [paymentInfo?.image],
              },
            },
            quantity: 1,
          },
        ],
        customer_email: paymentInfo?.userEmail,
        mode: "payment",
        metadata: {
          orderId: paymentInfo?.orderId,
          bookId: paymentInfo?.bookId,
          userName: paymentInfo?.userName,
          bookName: paymentInfo?.bookName,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });
      res.send({ url: session.url });
    });

    // retrieve payment info, update order and make invoice
    app.post("/payment-success", verifyJWT, async (req, res) => {
      const { sessionId } = req.body;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      // console.log(session)
      const paymentResult = {
        bookName: session?.metadata?.bookName,
        buyerEmail: session?.customer_email,
        buyerName: session?.metadata?.userName,
        transactionId: session?.payment_intent,
        bookId: session?.metadata?.bookId,
        orderId: session?.metadata?.orderId,
        price: session.amount_total / 100,
        paidAt: new Date(),
      };

      const alreadyPaid = await invoiceCollection.findOne({
        transactionId: session?.payment_intent,
      });

      // saving data in invoice
      if (!alreadyPaid) {
        const result = await invoiceCollection.insertOne(paymentResult);
      }

      const query = { _id: new ObjectId(paymentResult.orderId) };

      const updateOrder = {
        $set: {
          transactionId: paymentResult.transactionId,
          paymentStatus: "paid",
        },
      };

      // update order
      const updatedResult = await ordersCollection.updateOne(
        query,
        updateOrder
      );
      res.send(updatedResult);
    });

    // get all invoices of a user API
    app.get("/my-invoice", verifyJWT, async (req, res) => {
      const email = req.tokenEmail;
      const query = {};
      if (email) {
        query.buyerEmail = email;
      }
      const result = await invoiceCollection.find(query).toArray();
      res.send(result);
    });

    // reviews related APIs here
    // review save in the database
    app.post("/book-review", verifyJWT, async (req, res) => {
      const review = req.body;
      const reviewData = {
        ...review,
        reviewedAt: new Date(),
      };
      const result = await reviewCollection.insertOne(reviewData);
      res.send(result);
    });

    //get recent 5 reviews of a book from database
    app.get("/book-review/:id", async (req, res) => {
      const { id } = req.params;
      const filter = { bookId: id };
      const result = await reviewCollection
        .find(filter)
        .sort({ reviewedAt: -1 })
        .limit(5)
        .toArray();
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from Server..");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
