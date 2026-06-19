import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";

loadEnv();

const prisma = new PrismaClient();
const MILE = 1609.344;

async function main() {
  // Reset
  await prisma.lap.deleteMany();
  await prisma.runner.deleteMany();
  await prisma.eventConfig.deleteMany();

  // Event started 5 hours ago, 24h long, 5-mile laps.
  const start = new Date(Date.now() - 5 * 60 * 60_000);
  await prisma.eventConfig.create({
    data: {
      id: 1,
      eventName: "Endure24",
      teamName: "The Sole Survivors",
      startAt: start,
      durationHours: 24,
      lapDistanceMiles: 5,
    },
  });

  const names = ["Alex", "Sam", "Jordan", "Riley", "Casey", "Morgan"];
  const runners = [];
  for (let i = 0; i < names.length; i++) {
    runners.push(
      await prisma.runner.create({
        data: { name: names[i], rotationPosition: i, refreshToken: "seed", active: true },
      })
    );
  }

  // Simulate ~90 min of laps cycling through the rotation.
  let t = start.getTime();
  let i = 0;
  const lapTimes = [2400, 2550, 2700, 2500, 2900, 2650]; // seconds per runner (40–48 min)
  while (t < Date.now() - lapTimes[i % 6] * 1000) {
    const runner = runners[i % 6];
    const dur = lapTimes[i % 6] + Math.round((Math.random() - 0.5) * 120);
    await prisma.lap.create({
      data: {
        runnerId: runner.id,
        distanceMeters: 5 * MILE + (Math.random() - 0.5) * 200,
        movingTimeSec: dur,
        elapsedTimeSec: dur,
        startedAt: new Date(t),
        source: "manual",
      },
    });
    t += dur * 1000;
    i++;
  }

  console.log(`Seeded ${i} laps across ${runners.length} runners. Current runner: ${runners[i % 6].name}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
