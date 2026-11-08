# BookNook Backend API

### Short Description
The BookNook Backend is a resilient, serverless-ready RESTful API built with **Node.js** and **Express.js**. It serves as the data powerhouse for the BookNook library platform, handling secure book management, real-time inventory tracking, and complex borrowing workflows. Designed with a decoupled architecture, this backend securely verifies JSON Web Tokens (JWTs) using a remote JWKS (JSON Web Key Set) provided by the frontend, ensuring robust authentication without tightly coupling the auth provider to the database layer.

**Frontend Repository:** https://github.com/abdul-wahid789/booknook.git </br>
**Live API Endpoint:** https://booknook-server-nine-omega.vercel.app

---

### Key Technical Features

1. **Decoupled JWKS Authentication**
   Instead of handling passwords directly, the backend implements stateless authentication using the `jose` library. A custom Express middleware intercepts requests, extracts the Bearer token, and securely verifies the payload against the frontend's remote JWKS endpoint (`/api/auth/jwks`).

2. **Transactional Inventory Management**
   The backend intelligently handles book availability to prevent stock inconsistencies. When a user borrows a book, MongoDB dynamically decrements the `totalCopies`. When returned, the stock is incremented. The API also explicitly blocks the deletion of any book currently held by a reader.

3. **Advanced MongoDB Aggregations**
   Leverages native MongoDB aggregation pipelines (e.g., `$lookup`, `$match`, `$unwind`) in the `/borrows/user/:userEmail` route to perform relational-style joins. This efficiently merges a user's active borrow records with the associated book details in a single, highly performant database query.

4. **RESTful Architecture & Error Handling**
   Features a clean, predictable RESTful routing structure. Every endpoint is fortified with comprehensive try-catch blocks and explicit payload validation (checking `ObjectId` validity before querying) to prevent server crashes and return standardized JSON error responses.

5. **Serverless-Optimized Integration**
   Engineered for smooth deployment on Vercel's serverless infrastructure. Database connections are configured to handle cold starts and prevent connection leaks when serverless functions are frozen or awoken.

---

### Technologies Used

* **Runtime & Framework:** Node.js, Express.js
* **Database:** MongoDB (Native Node.js Driver)
* **Security & Auth Verification:** `jose` (JWT verification), CORS
* **Environment Management:** `dotenv`
* **Deployment:** Vercel (Serverless Functions)

---

### API Route Reference

#### Books Collection
| Method | Endpoint | Description | Protected |
| :--- | :--- | :--- | :---: |
| `GET` | `/books?limit=6` | Fetch all books (with optional limit) | ❌ |
| `GET` | `/books/user/:userEmail` | Fetch all books contributed by a specific user | 🔒 Yes |
| `GET` | `/books/:id` | Fetch a single book's details by its MongoDB `_id` | 🔒 Yes |
| `POST` | `/books` | Add a new book to the library | 🔒 Yes |
| `PUT` | `/books/:id` | Update an existing book's details | 🔒 Yes |
| `DELETE` | `/books/:id` | Delete a book (blocked if currently borrowed) | 🔒 Yes |

#### Borrowing Collection
| Method | Endpoint | Description | Protected |
| :--- | :--- | :--- | :---: |
| `GET` | `/borrows/check/:bookId/:userEmail`| Check if a user has an active borrow for a book | 🔒 Yes |
| `GET` | `/borrows/user/:userEmail` | Fetch a user's active borrowed books (joined data) | 🔒 Yes |
| `POST` | `/borrows` | Create a new borrow record & decrement stock | 🔒 Yes |
| `POST` | `/borrows/return/:borrowId` | Mark book returned & increment stock | 🔒 Yes |
