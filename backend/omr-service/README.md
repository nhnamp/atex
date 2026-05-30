# Python OMR Service

This is the Python-based Optical Mark Recognition (OMR) microservice that handles student identity (MSSV) and multiple-choice question (MCQ) reading from exam scans. 

It replaces the previous Node.js `opencv4nodejs` implementation for improved stability and performance.

## Prerequisites

- Python 3.12+

## Installation

Install the required Python dependencies:

```bash
cd backend/omr-service
pip3 install --break-system-packages -r requirements.txt
```

## Running the Service

Start the Flask API server (it listens on port 5001 by default):

```bash
cd backend/omr-service
python3 omr_server.py
```

## API Endpoint

**POST /api/omr/process**

Accepts `multipart/form-data` with an `image` file and optional `total_questions` (defaults to 52).

Response:
```json
{
  "studentCode": "22521000",
  "answers": {
    "1": "A",
    "2": "B",
    ...
  },
  "confidence": 0.85,
  "warnings": []
}
```

## Running Tests

Test the OMR processor using the mixed data set in `test/Mixed/`:

```bash
python3 ../../test/omr_service/test_omr.py
```
