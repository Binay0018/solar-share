import { pathToFileURL } from "node:url";

const backendUrl = process.env.BACKEND_URL ?? "http://localhost:3000";
const intervalMs = Number(process.env.INTERVAL_MS ?? 10000);
const users = (process.env.SIMULATOR_USERS ?? "household-1,household-2")
	.split(",")
	.map((userId) => userId.trim())
	.filter(Boolean);
const startHour = Number(process.env.START_HOUR ?? 12);
const runOnce = process.env.RUN_ONCE === "true" || process.argv.includes("--once");

function randomVariation(amount = 0.1) {
	return 1 + (Math.random() * 2 - 1) * amount;
}

function daylightGeneration(hour) {
	if (hour < 6 || hour > 18) return 0;

	const daylightProgress = (hour - 6) / 12;
	return 4 * Math.sin(Math.PI * daylightProgress) * randomVariation(0.12);
}

function householdConsumption(hour) {
	const morningPeak = hour >= 6 && hour <= 9 ? 0.9 : 0;
	const eveningPeak = hour >= 17 && hour <= 22 ? 1.2 : 0;
	return (0.35 + morningPeak + eveningPeak) * randomVariation(0.08);
}

export function generateReading(userId, hour, timestamp = new Date().toISOString()) {
	const generationKWh = Number(daylightGeneration(hour).toFixed(3));
	const consumptionKWh = Number(householdConsumption(hour).toFixed(3));
	const surplusKWh = Number((generationKWh - consumptionKWh).toFixed(3));

	return {
		userId,
		timestamp,
		generationKWh,
		consumptionKWh,
		surplusKWh
	};
}

export async function postReading(reading) {
	const response = await fetch(`${backendUrl}/meter-readings`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(reading)
	});

	if (!response.ok) {
		throw new Error(`Backend returned ${response.status} for ${reading.userId}`);
	}

	return response.json();
}

async function sendHour(hour) {
	const readings = users.map((userId) => generateReading(userId, hour));
	for (const reading of readings) {
		try {
			const result = await postReading(reading);
			console.log(JSON.stringify({ reading, result }));
		} catch (error) {
			console.error(`Failed to post reading for ${reading.userId}: ${error.message}`);
		}
	}
}

export async function run() {
	let simulatedHour = ((startHour % 24) + 24) % 24;
	console.log(`SolarShare IoT simulator posting to ${backendUrl}/meter-readings`);
	console.log(`Users: ${users.join(", ")}; interval: ${intervalMs} ms`);

	await sendHour(simulatedHour);
	if (runOnce) return;

	setInterval(async () => {
		simulatedHour = (simulatedHour + 1) % 24;
		await sendHour(simulatedHour);
	}, intervalMs);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await run();
}
