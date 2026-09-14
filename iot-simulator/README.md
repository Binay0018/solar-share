# SolarShare IoT Simulator

Generates synthetic hourly household meter readings and posts them to the backend.

The PV profile is zero overnight and peaks around midday. Household consumption has morning and evening peaks. One simulator interval represents one simulated hour.

```bash
npm start
npm run once
npm run day
```

Configuration uses environment variables:

- `BACKEND_URL` (default `http://localhost:3000`)
- `INTERVAL_MS` (default `10000`)
- `SIMULATOR_USERS` (default `household-1,household-2`)
- `START_HOUR` (default `0`)
- `RUN_ONCE=true` to post one simulated hour and exit

`npm run day` posts 24 simulated hours for every configured user and prints a summary of readings, generated offers, and matching attempts. It requires the backend and MongoDB to be running.
