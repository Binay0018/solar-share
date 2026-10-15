import { Router } from "express";

import { getNews } from "../services/newsService.js";

/* Read-only energy news feed.
   Aggregated server-side so publisher traffic never originates from the
   browser and no credential has to exist in the frontend bundle. The feed is
   independent of MongoDB, so it stays available even if the database is down. */

const router = Router();

router.get("/", async (request, response, next) => {
  try {
    const force = ["1", "true", "yes"].includes(String(request.query.refresh ?? "").toLowerCase());
    const payload = await getNews({ force });
    response.set("cache-control", "no-store");
    return response.json(payload);
  } catch (error) {
    return next(error);
  }
});

export default router;
