import dotenv from "dotenv";

// Imported first in index.js so .env values are available before
// route modules read configuration at import-evaluation time.
dotenv.config();
