// tests/drawer_activity.test.js
const path = require("path");
const { readFileSync } = require("fs");
const {
    initializeTestEnvironment,
    assertSucceeds,
    assertFails,
} = require("@firebase/rules-unit-testing");

// Match your emulator settings
const FIRESTORE_HOST = "127.0.0.1";
const FIRESTORE_PORT = 8081;

let testEnv;

beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: "demo-test-drawer-activity",
        firestore: {
            host: FIRESTORE_HOST,
            port: FIRESTORE_PORT,
            rules: readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8"),
        },
    });
});

afterAll(async () => {
    if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
    if (testEnv) await testEnv.clearFirestore();
});

// -------- helpers --------
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

function staffOtherStoreCtx() {
    return staffCtx({ storeId: "TP02", userId: "STF002" });
}

function adminCtx({ companyId = "NE001" } = {}) {
    return testEnv.authenticatedContext("admin-ne001", {
        role: "admin",
        companyId,
    });
}

function adminOtherCompanyCtx() {
    return testEnv.authenticatedContext("admin-ne002", {
        role: "admin",
        companyId: "NE002",
    });
}

// Seeds an OPEN shift doc at /shifts/{shiftId}
async function seedOpenShift(shiftId = "SHIFT1") {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await ctx.firestore().collection("shifts").doc(shiftId).set({
            companyId: "NE001",
            storeId: "TP01",
            userId: "STF001",
            startedAt: new Date(),
            // endedAt missing => open
        });
    });
    return shiftId;
}

describe("Drawer Activity (subcollection of shifts)", () => {
    test("Staff can CREATE cash-in/out on own store's OPEN shift", async () => {
        const shiftId = await seedOpenShift("S1");
        const db = staffCtx().firestore();

        const ref = db
            .collection("shifts")
            .doc(shiftId)
            .collection("drawer_activity")
            .doc();

        await assertSucceeds(
            ref.set({
                companyId: "NE001",
                storeId: "TP01",
                type: "cash_in", // or 'cash_out'
                amount: 50.0,
                createdAt: new Date(),
                note: "float top-up",
            })
        );
    });

    test("Staff of OTHER store cannot CREATE on this shift", async () => {
        const shiftId = await seedOpenShift("S2");
        const db = staffOtherStoreCtx().firestore();

        const ref = db
            .collection("shifts")
            .doc(shiftId)
            .collection("drawer_activity")
            .doc();

        await assertFails(
            ref.set({
                companyId: "NE001",
                storeId: "TP01", // doc says TP01 but user is TP02 -> deny
                type: "cash_out",
                amount: 10.0,
                createdAt: new Date(),
            })
        );
    });

    test("Staff can READ entries from own store; cross-store denied", async () => {
        const shiftId = await seedOpenShift("S3");

        // seed one entry
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx
                .firestore()
                .collection("shifts")
                .doc(shiftId)
                .collection("drawer_activity")
                .doc("E1")
                .set({
                    companyId: "NE001",
                    storeId: "TP01",
                    type: "cash_in",
                    amount: 20,
                    createdAt: new Date(),
                });
        });

        // same-store staff -> allowed
        const staffDb = staffCtx().firestore();
        await assertSucceeds(
            staffDb
                .collection("shifts")
                .doc(shiftId)
                .collection("drawer_activity")
                .doc("E1")
                .get()
        );

        // other-store staff -> denied
        const otherDb = staffOtherStoreCtx().firestore();
        await assertFails(
            otherDb
                .collection("shifts")
                .doc(shiftId)
                .collection("drawer_activity")
                .doc("E1")
                .get()
        );
    });

    test("Staff cannot UPDATE or DELETE entries; Admin can UPDATE but not DELETE", async () => {
        const shiftId = await seedOpenShift("S4");

        // seed entry
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx
                .firestore()
                .collection("shifts")
                .doc(shiftId)
                .collection("drawer_activity")
                .doc("E2")
                .set({
                    companyId: "NE001",
                    storeId: "TP01",
                    type: "cash_in",
                    amount: 30,
                    createdAt: new Date(),
                });
        });

        const staffDb = staffCtx().firestore();
        const adminDb = adminCtx({ companyId: "NE001" }).firestore();

        // staff UPDATE -> denied
        await assertFails(
            staffDb
                .collection("shifts")
                .doc(shiftId)
                .collection("drawer_activity")
                .doc("E2")
                .update({ note: "edit not allowed" })
        );

        // staff DELETE -> denied
        await assertFails(
            staffDb
                .collection("shifts")
                .doc(shiftId)
                .collection("drawer_activity")
                .doc("E2")
                .delete()
        );

        // admin UPDATE -> allowed (corrections)
        await assertSucceeds(
            adminDb
                .collection("shifts")
                .doc(shiftId)
                .collection("drawer_activity")
                .doc("E2")
                .update({ note: "manager correction" })
        );

        // admin DELETE -> denied (immutable audit)
        await assertFails(
            adminDb
                .collection("shifts")
                .doc(shiftId)
                .collection("drawer_activity")
                .doc("E2")
                .delete()
        );
    });

    test("Admin of OTHER company cannot READ entries (cross-company deny)", async () => {
        const shiftId = await seedOpenShift("S5");
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx
                .firestore()
                .collection("shifts")
                .doc(shiftId)
                .collection("drawer_activity")
                .doc("E3")
                .set({
                    companyId: "NE001",
                    storeId: "TP01",
                    type: "cash_out",
                    amount: 5,
                    createdAt: new Date(),
                });
        });

        const otherAdminDb = adminOtherCompanyCtx().firestore();
        await assertFails(
            otherAdminDb
                .collection("shifts")
                .doc(shiftId)
                .collection("drawer_activity")
                .doc("E3")
                .get()
        );
    });
});
