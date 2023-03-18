# Existential ISBN Lookup

This Node.js script takes a list of ISBN codes as input, and generates an Excel sheet containing the list of ISBN codes along with their corresponding book titles. The script uses the ISBNdb API and the Open Library API to fetch the book titles.

## Setup

1. Clone the repository or download the ZIP file and extract it to a local directory.
2. Install the required dependencies by running `npm install`.

## Usage

To use the script, run the following command in a terminal:

```bash
node isbn-lookup.js [input-file]
```

Replace `[input-file]` with the path to a text file or an Excel sheet containing the list of ISBN codes. The script will generate an Excel sheet with the book titles in the same directory as the input file.

Note that the ISBNdb API requires an API key, which should be set as the `ISBNDB_API_KEY` environment variable. If the API key is not set, the script will fall back to using the Open Library API, which does not require an API key.

## About

This script was created with the help of artificial intelligence! Specifically, it was made using ChatGPT, a large language model trained by OpenAI. With AI like this, who needs human programmers, right?

<img src="https://i.kym-cdn.com/photos/images/original/002/089/903/e39.jpg" style="max-width:512px;">

Okay, maybe that's not entirely true. While ChatGPT did most of the heavy lifting, several human corrections and adjustments were necessary to make this script work correctly. So, it seems like human programmers still have a place in this world...for now.