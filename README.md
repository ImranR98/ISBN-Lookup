# ISBN Lookup

Find book titles and authors by ISBN. Supports mass search to look up multiple ISBNs at once.

## Usage

1. Clone the repository or download the ZIP file and extract it to a local directory.
2. Install the required dependencies by running `npm install`.
3. Optional: Define a `.env` file with an `ISBNDB_API_KEY` variable.
4. Run `npm start` to start the web app
   - Or use the CLI version by running `node cli.js <input file>` where `<input file>` is a `txt` or `xlsx` file containing a list of ISBNs (output will be generated as an `xlsx`).

## APIs Used

The following APIs are checked (results are sorted by descending order of title length, and UI shows the top result):
1. [ISBNdb](https://isbndb.com/apidocs/v2) (if an API key is available in the `ISBNDB_API_KEY` environment variable)
2. [Google Books](https://developers.google.com/books/)
3. [Open Library](https://openlibrary.org/developers/api)