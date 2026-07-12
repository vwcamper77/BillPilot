import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { decryptObjectFields } from "@/lib/security/encryption";
import { SECURE_IMPORT_SENSITIVE_FIELDS } from "@/lib/security/sensitiveFields";

const RESET_DOC_TARGETS = [
  ["settings", "balance"],
  ["settings", "savings"],
  ["income", "main"],
  ["debug", "test"],
];

const RESET_COLLECTION_TARGETS = [
  "bills",
  "incomeEvents",
  "largeCosts",
  "reminders",
  "imports",
  "bankImports",
  "statements",
  "secureImports",
];

export async function resetUserData(userId) {
  const userRef = getUserRef(userId);
  let deletedDocs = 0;
  let deletedCollections = 0;

  // Reset preserves account access plus future preferences, billing, and legal records.
  for (const [collectionName, docId] of RESET_DOC_TARGETS) {
    const deletedCount = await deleteDocumentIfPresent(userRef.collection(collectionName).doc(docId));

    if (deletedCount > 0) {
      deletedDocs += 1;
    }
  }

  for (const collectionName of RESET_COLLECTION_TARGETS) {
    const deletedCount = await deleteCollectionRecursive(userRef.collection(collectionName));

    if (deletedCount > 0) {
      deletedCollections += 1;
    }
  }

  return {
    deletedCollections,
    deletedDocs,
  };
}

export async function deleteUserData(userId) {
  const userRef = getUserRef(userId);
  const collections = await userRef.listCollections();
  let deletedCollections = 0;
  let deletedDocuments = 0;

  for (const collectionRef of collections) {
    const deletedCount = await deleteCollectionRecursive(collectionRef);

    if (deletedCount > 0) {
      deletedCollections += 1;
      deletedDocuments += deletedCount;
    }
  }

  await userRef.delete().catch(() => undefined);

  return {
    deletedCollections,
    deletedDocuments,
  };
}

/**
 * Gather all of a user's ClearTill data into a plain JSON object so they can
 * download a copy ("Export my data"). Sensitive fields in the server-only
 * `secureImports` archive are decrypted here so the export is human-readable.
 * Other collections are already plaintext at rest.
 */
export async function exportUserData(userId) {
  const userRef = getUserRef(userId);
  const collections = await userRef.listCollections();
  const data = {};

  for (const collectionRef of collections) {
    const snapshot = await collectionRef.get();
    data[collectionRef.id] = snapshot.docs.map((docSnap) => {
      const raw = { id: docSnap.id, ...docSnap.data() };

      if (collectionRef.id === "secureImports") {
        return decryptObjectFields(raw, userId, SECURE_IMPORT_SENSITIVE_FIELDS);
      }

      return raw;
    });
  }

  return {
    exportedAt: new Date().toISOString(),
    userId,
    data,
  };
}

export async function deleteUserAccount(user) {
  const uid = typeof user === "string" ? user : user?.uid;

  if (!uid) {
    throw new Error("Missing user id.");
  }

  const dataSummary = await deleteUserData(uid);

  await getAdminAuth().deleteUser(uid);

  return {
    ...dataSummary,
    deletedAuthUser: true,
  };
}

function getUserRef(userId) {
  if (!userId) {
    throw new Error("Missing user id.");
  }

  return getAdminDb().collection("users").doc(userId);
}

async function deleteDocumentIfPresent(docRef) {
  const snapshot = await docRef.get();

  if (!snapshot.exists) {
    return 0;
  }

  return deleteDocumentRecursive(docRef);
}

async function deleteDocumentRecursive(docRef) {
  const subcollections = await docRef.listCollections();

  for (const subcollectionRef of subcollections) {
    await deleteCollectionRecursive(subcollectionRef);
  }

  await docRef.delete();

  return 1;
}

async function deleteCollectionRecursive(collectionRef) {
  let deletedCount = 0;

  while (true) {
    const snapshot = await collectionRef.limit(50).get();

    if (snapshot.empty) {
      return deletedCount;
    }

    for (const documentSnapshot of snapshot.docs) {
      deletedCount += await deleteDocumentRecursive(documentSnapshot.ref);
    }
  }
}
