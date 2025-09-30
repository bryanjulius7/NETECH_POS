// tests/shifts.test.js
const path = require("path");
const { readFileSync } = require("fs");
const {
    initializeTestEnvironment,
    assertSucceeds,
    assertFails,
} = require("@firebase/rules-unit-testing");

// ⚠️ Adjust to match your firebase.json emulator port if different
const FIRESTORE_HOST = "127.0.0.1";
const FIRESTORE_PORT = 8081;

let testEnv;

beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
        projectId: "demo-test-shifts",
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

// ---- helpers ----
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

describe("Shifts rules — open/close", () => {
    test("Staff can OPEN a shift for own store (endedAt missing/null)", async () => {
        const db = staffCtx().firestore();
        const ref = db.collection("shifts").doc();
        await assertSucceeds(
            ref.set({
                companyId: "NE001",
                storeId: "TP01",
                userId: "STF001",
                startedAt: new Date(),
                // endedAt intentionally missing
            })
        );
    });

    test("Staff CANNOT open a shift if endedAt is already set", async () => {
        const db = staffCtx().firestore();
        const ref = db.collection("shifts").doc();
        await assertFails(
            ref.set({
                companyId: "NE001",
                storeId: "TP01",
                userId: "STF001",
                startedAt: new Date(),
                endedAt: new Date(), // not allowed by rules
            })
        );
    });

    test("Staff can CLOSE own store’s open shift (only set endedAt; identity fields unchanged)", async () => {
        const staff = staffCtx();
        const db = staff.firestore();
        const ref = db.collection("shifts").doc("S1");

        // seed open shift as staff
        await assertSucceeds(
            ref.set({
                companyId: "NE001",
                storeId: "TP01",
                userId: "STF001",
                startedAt: new Date(),
                // endedAt missing = open
            })
        );

        // close it (update endedAt only)
        await assertSucceeds(
            ref.update({
                endedAt: new Date(),
            })
        );
    });

    test("Staff of OTHER store cannot READ/UPDATE a shift", async () => {
        // Seed an NE001/TP01 shift without rules
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx
                .firestore()
                .collection("shifts")
                .doc("S2")
                .set({
                    companyId: "NE001",
                    storeId: "TP01",
                    userId: "STF001",
                    startedAt: new Date(),
                });
        });

        const other = staffOtherStoreCtx().firestore();
        await assertFails(other.collection("shifts").doc("S2").get());
        await assertFails(
            other.collection("shifts").doc("S2").update({ endedAt: new Date() })
        );
    });

    test("Admin of same company can READ and UPDATE a shift", async () => {
        // Seed NE001 shift
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx
                .firestore()
                .collection("shifts")
                .doc("S3")
                .set({
                    companyId: "NE001",
                    storeId: "TP01",
                    userId: "STF001",
                    startedAt: new Date(),
                });
        });

        const adminDb = adminCtx({ companyId: "NE001" }).firestore();
        await assertSucceeds(adminDb.collection("shifts").doc("S3").get());
        await assertSucceeds(
            adminDb.collection("shifts").doc("S3").update({ note: "adjustment OK" })
        );
    });

    test("Admin of OTHER company cannot READ a shift", async () => {
        // Seed NE001 shift
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx
                .firestore()
                .collection("shifts")
                .doc("S4")
                .set({
                    companyId: "NE001",
                    storeId: "TP01",
                    userId: "STF001",
                    startedAt: new Date(),
                });
        });

        const otherAdminDb = adminOtherCompanyCtx().firestore();
        await assertFails(otherAdminDb.collection("shifts").doc("S4").get());
    });

    test("DELETE is never allowed (audit trail)", async () => {
        // Seed NE001 shift
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
            await ctx
                .firestore()
                .collection("shifts")
                .doc("S5")
                .set({
                    companyId: "NE001",
                    storeId: "TP01",
                    userId: "STF001",
                    startedAt: new Date(),
                });
        });

        const staffDb = staffCtx().firestore();
        await assertFails(staffDb.collection("shifts").doc("S5").delete());

        const adminDb = adminCtx().firestore();
        await assertFails(adminDb.collection("shifts").doc("S5").delete());
    });
});
