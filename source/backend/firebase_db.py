
import os

import firebase_admin
from firebase_admin import credentials, firestore
from django.conf import settings


# Initialize Firebase only once
if not firebase_admin._apps:
    credentials_path = settings.FIREBASE_CREDENTIALS_PATH

    # Verify service-account JSON file exists
    if not os.path.isfile(credentials_path):
        raise FileNotFoundError(
            f"Firebase credentials file not found: {credentials_path}"
        )

    # Load Firebase service-account credentials
    cred = credentials.Certificate(str(credentials_path))

    # Initialize Firebase Admin SDK
    firebase_admin.initialize_app(cred)


# Firestore database client
db = firestore.client()


def get_collection(collection_name):
    """Return a Firestore collection reference."""
    return db.collection(collection_name)


def get_document(collection_name, document_id):
    """Return a Firestore document reference."""
    return db.collection(collection_name).document(document_id)


def add_document(collection_name, data, document_id=None):
    """Add a document or save it with a specified ID."""
    collection = db.collection(collection_name)

    if document_id:
        collection.document(str(document_id)).set(data)
        return str(document_id)

    document_ref = collection.add(data)[1]
    return document_ref.id


def get_all_documents(collection_name):
    """Fetch all documents from a collection."""
    documents = db.collection(collection_name).stream()

    return [
        {"id": document.id, **document.to_dict()}
        for document in documents
    ]


def get_document_by_id(collection_name, document_id):
    """Fetch one document by its ID."""
    document_ref = get_document(collection_name, document_id)
    document = document_ref.get()

    if not document.exists:
        return None

    return {"id": document.id, **document.to_dict()}


def update_document(collection_name, document_id, data):
    """Update existing document fields."""
    document_ref = get_document(collection_name, document_id)

    if not document_ref.get().exists:
        return False

    document_ref.update(data)
    return True


def delete_document(collection_name, document_id):
    """Delete a document by its ID."""
    document_ref = get_document(collection_name, document_id)

    if not document_ref.get().exists:
        return False

    document_ref.delete()
    return True

