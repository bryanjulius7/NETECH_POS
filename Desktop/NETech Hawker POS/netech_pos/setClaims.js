// setClaims.js
import admin from "firebase-admin";
import { readFileSync } from "fs";

// Initialize Firebase Admin SDK using service account
admin.initializeApp({
    credential: admin.credential.cert(
        JSON.parse(readFileSync("./serviceAccountKey.json", "utf8"))
    ),
});

async function main() {
    // Replace the UIDs with the real ones from Firebase Authentication (prod)

    // Admin for NE001
    await admin.auth().setCustomUserClaims(
        "A9fLjVhrUfQlyaSU2kAQuj717ij2", // UID from Firebase Auth
        { role: "admin", companyId: "NE001" }
    );

    // Staff for TP01 / NE001
    await admin.auth().setCustomUserClaims(
        "xUGA0EoIM7XvkCNs8aSAAMYAWoq1", // UID from Firebase Auth
        { role: "staff", companyId: "NE001", storeId: "TP01", userId: "STF001" }
    );

    // Admin for NE002
    await admin.auth().setCustomUserClaims(
        "tZ8YFzLVcATzbsmrPgjbJP1zVdl2", // UID from Firebase Auth
        { role: "admin", companyId: "NE002" }
    );

    console.log("✅ Custom claims applied (ESM version)");
}

main().catch(console.error);
