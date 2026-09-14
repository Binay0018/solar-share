import { generateReading, postReading } from "./simulator.js";

const users = (process.env.SIMULATOR_USERS ?? "household-1,household-2")
	.split(",")
	.map((userId) => userId.trim())
	.filter(Boolean);

const summary = {
	readings: 0,
	offers: 0,
	requests: 0,
	matchAttempts: 0,
	matchingFailures: 0
};

for (let hour = 0; hour < 24; hour += 1) {
	for (const userId of users) {
		const reading = generateReading(userId, hour);
		const result = await postReading(reading);
		summary.readings += 1;
		if (result.offer) summary.offers += 1;
		if (result.matching) {
			summary.matchAttempts += result.matching.attempted;
			summary.matchingFailures += result.matching.results.filter((match) => match.status === "failure").length;
		}
		if (reading.surplusKWh < 0) {
			const requestResponse = await fetch(`${process.env.BACKEND_URL ?? "http://localhost:3000"}/trades`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					buyerId: userId,
					kWhNeeded: Number(Math.abs(reading.surplusKWh).toFixed(3)),
					maxPricePerKWh: 1
				})
			});
			if (!requestResponse.ok) throw new Error(`Trade request failed for ${userId}`);
			const requestResult = await requestResponse.json();
			summary.requests += 1;
			if (requestResult.matching) {
				summary.matchAttempts += requestResult.matching.attempted;
				summary.matchingFailures += requestResult.matching.results.filter((match) => match.status === "failure").length;
			}
		}
	}
}

console.log(JSON.stringify({ simulatedHours: 24, users, ...summary }, null, 2));