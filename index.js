require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const port = process.env.PORT || 3000;
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
      "https://b12-m11-session.web.app",
    ],
    credentials: true,
    optionSuccessStatus: 200,
  })
);
app.use(express.json());

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  console.log(token);
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    console.log(decoded);
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

    // users apis
    app.post("/users", async (req, res) => {
      const user = req.body;
      const isExists = await usersCollection.findOne({ email: user.email });
      if (isExists) {
        return res.send({ message: "User already exist" });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get('/users/:email', verifyJWT, async (req, res) => {
      const { email } = req.params;
      const result = await usersCollection.findOne({email})
      res.send(result)
    })

    app.patch('/users/:email', verifyJWT, async (req, res) => {
      const { email } = req.params
      const { name, photo } = req.body;
      const updateInfo = {
        $set: {
          name,
          photo
        }
      }
      const result = await usersCollection.updateOne({ email: email }, updateInfo);
      res.send(result)
    })

    // books collection apis
    app.post("/books", verifyJWT, async (req, res) => {
      const email = req.tokenEmail;
      const book = req.body;
      if (email) {
        book.createdBy = email;
        book.createdAt = new Date().toISOString();
      }
      const result = await booksCollection.insertOne(book);
      res.send(result);
    });

    app.get("/books", verifyJWT, async (req, res) => {
      const search = req.query.search;
      const sort = req.query.sort;

      let filter = {
        status: "published",
        bookName: { $regex: search, $options: "i" },
      };

      let sortOption = {};

      if (sort === "low-to-high") sortOption = { price: 1 };
      if (sort === "high-to-low") sortOption = { price: -1 };
      const result = await booksCollection
        .find(filter)
        .sort(sortOption)
        .toArray();
      res.send(result);
    });

    app.get("/books/:id", async (req, res) => {
      const { id } = req.params;
      const filter = { _id: new ObjectId(id) };
      const result = await booksCollection.findOne(filter);
      // console.log(result)
      res.send(result);
    });

    app.get("/latest-books", async (req, res) => {
      const result = await booksCollection
        .find()
        .sort({ createdAt: -1 })
        .limit(6)
        .toArray();
      res.send(result);
    });

    // orders collections APIs
    app.post("/orders", async (req, res) => {
      const orders = req.body;
      orders.orderStatus = "pending";
      orders.paymentStatus = "unpaid";
      orders.createdAt = new Date().toISOString();
      orders.transactionId = null;
      const result = await ordersCollection.insertOne(orders);
      res.send(result);
    });

    app.get("/my-orders", verifyJWT, async (req, res) => {
      const email = req.tokenEmail;
      // console.log(email)
      const result = await ordersCollection
        .find({ userEmail: email })
        .toArray();
      res.send(result);
    });

    app.patch("/orders/cancel/:id", verifyJWT, async (req, res) => {
      const { id } = req.params;
      const filter = { _id: new ObjectId(id), orderStatus: "pending" };
      const update = {
        $set: {
          orderStatus: "cancelled",
          cancelledAt: new Date().toISOString(),
        },
      };
      const result = await ordersCollection.updateOne(filter, update);
      res.send(result);
    });

    // wishlist apis here
    app.post("/wishlist", async (req, res) => {
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

    app.get("/my-wishlist/:email", verifyJWT, async (req, res) => {
      const { email } = req.params;
      const filter = { userEmail: email };
      const result = await wishlistCollection.find(filter).toArray();
      res.send(result)
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
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
