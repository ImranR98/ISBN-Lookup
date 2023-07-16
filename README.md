# ISBN Lookup

Finds book titles for a list of ISBN codes using various APIs.

## Usage

1. Clone the repository or download the ZIP file and extract it to a local directory.
2. Install the required dependencies by running `npm install`.
3. Optional: Define a `.env` file with an `ISBNDB_API_KEY` variable.
4. Run `npm start` to start the web app
   - Or use the CLI version by running `node cli.js <input file>` where `<input file>` is a `txt` or `xlsx` file containing a list of ISBNs (output will be generated as an `xlsx`).

## APIs Used

The following APIs are tried in this order:
1. [ISBNdb](https://isbndb.com/apidocs/v2) (if an API key is available in the `ISBNDB_API_KEY` environment variable)
2. [Open Library](https://openlibrary.org/developers/api)
3. [Google Books](https://developers.google.com/books/)