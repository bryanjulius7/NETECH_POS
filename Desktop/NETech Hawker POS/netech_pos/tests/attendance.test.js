// tests/attendance.test.js
const path = require("path");
const { readFileSync } = require("fs");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");

let testEnv;

// Adjust the port to match your firebase.json (you used 8081 earlier)
const FIRESTORE_HOST = "127.0.0.1";
const FIRESTORE_PORT = 8081;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-test", // any string is fine for local emulator
    firestore: {
      host: FIRESTORE_HOST,
      port: FIRESTORE_PORT,
      rules: readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8"),
    },
  });
});

afterAll(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

beforeEach(async () => {
  if (testEnv) {
    await testEnv.clearFirestore();
  }
});

// helpers to build auth contexts matching your rules
function staffCtx({
  uid = "staff-stf001",
  companyId = "NE001",
  storeId = "TP01",
  userId = "STF001",
} = {}) {
  return testEnv.authenticatedContext(uid, {
    role: "staff",
    companyId,
    storeId,
    userId,
  });
}
function adminCtx({ uid = "admin-ne001", companyId = "NE001" } = {}) {
  return testEnv.authenticatedContext(uid, {
    role: "admin",
    companyId,
  });
}

describe("Attendance rules", () => {
  test("Staff can create self clock-in (no clockOut)", async () => {
    const db = staffCtx().firestore();
    const ref = db.collection("attendance").doc();

    await assertSucceeds(
      ref.set({
        companyId: "NE001",
        storeId: "TP01",
        userId: "STF001",
        clockIn: new Date(), // JS Date works in emulator tests
        // no clockOut
      })
    );
  });

  test("Staff cannot create attendance for other user", async () => {
    const db = staffCtx().firestore();
    const ref = db.collection("attendance").doc();

    await assertFails(
      ref.set({
        companyId: "NE001",
        storeId: "TP01",
        userId: "STF999", // different from claim
        clockIn: new Date(),
      })
    );
  });

  test("Staff can clock-out own open record", async () => {
    const db = staffCtx().firestore();
    const ref = db.collection("attendance").doc();

    // create open record
    await assertSucceeds(
      ref.set({
        companyId: "NE001",
        storeId: "TP01",
        userId: "STF001",
        clockIn: new Date(),
      })
    );

    // now only add clockOut
    await assertSucceeds(
      ref.update({
        clockOut: new Date(),
      })
    );
  });

  test("Admin NE001 can read NE001 doc; Admin NE002 denied (cross-company)", async () => {
    // Seed one NE001 doc with rules disabled
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx
        .firestore()
        .collection("attendance")
        .doc("A1")
        .set({
          companyId: "NE001",
          storeId: "TP01",
          userId: "STF001",
          clockIn: new Date(),
        });
    });

    // NE001 admin: allowed
    await assertSucceeds(
      adminCtx({ companyId: "NE001" })
        .firestore()
        .collection("attendance")
        .doc("A1")
        .get()
    );

    // NE002 admin: denied
    const ne002 = testEnv.authenticatedContext("admin-ne002", {
      role: "admin",
      companyId: "NE002",
    });
    await assertFails(
      ne002.firestore().collection("attendance").doc("A1").get()
    );
  });
});
