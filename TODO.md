TODO.md

- [x] Rename repositories in the packages/storage to use the word Storage instead of Repository.
- [ ] Vector Storage (not chunk storage)
  - [x] Rename the files from packages/storage/src/vector-storage to packages/storage/src/vector
  - [x] No fixed column names, use the schema to define the columns.
  - [ ] Option for which column to use if there are multiple, default to the first one.
  - [ ] Use @mceachen/sqlite-vec for sqlite storage.
- [ ] Datasets Package
  - [x] Documents dataset (mabye rename to DocumentDataset)
  - [ ] Chunks Package (or part of DocumentDataset?)
  - [ ] Move Model repository to datasets package.
- [ ] Chunks and nodes are not always the same.
  - [ ] And we may need to save the chunk's node path. Or paths? or document range? Standard metadata?
- [ ] Instead of passing doc_id around, pass a document key that is unknonwn (string or object)

- [ ] Get a better model for question answering.
- [ ] Get a better model for named entity recognition, the current one recognized everything as a token, not helpful.
- [ ] Titles are not making it into the chunks.
- [ ] Tests for CLI commands.

- [ ] Add ability for queues to specify if inputs should be converted to text, binary blob, a transferable object, structured clone, or just passed as is.
- [ ] Add specialized versions of the task queues for hugging face transformers and tensorflow mediapipe.
- [ ] Audio conversion like the image conversion
- [ ] rename the registration stuff to not look ugly: registerHuggingfaceTransformers() and registerHuggingfaceTransformersUsingWorkers() and registerHuggingfaceTransformersInsideWorker()
- [ ] fix image transferables

onnx-community/ModernBERT-finetuned-squad-ONNX - summarization

- [x] Auto-generated primary keys for TabularStorage
  - [x] Schema annotation with `x-auto-generated: true`
  - [x] Type system with `InsertEntity` for optional auto-generated keys
  - [x] Support for autoincrement (integer) and UUID (string) strategies
  - [x] Configurable client-provided keys: "never", "if-missing", "always"
  - [x] Implementations: InMemory, SQLite, Postgres, Supabase, IndexedDB, FsFolder
  - [x] Comprehensive test suite (342 tests pass)
  - [x] Documentation updated

Rework the Document Dataset. Currently there is a Document storage of tabular storage type, and that should be registered as a "dataset:document:source" meaning the source material in node format. And there is already a "dataset:document-chunk" for the chunk/vector storage which should be registered as a "dataset:document:chunk" with a well defined metadata schema. The two combined should be registered as a "dataset:document" which is the complete document with its source and all its chunks and metadata. This is for convenience but not used by tasks or ai tasks.

The sqlitevectorstorage currently does not use a built in vector search. Use @mceachen/sqlite-vec for sqlite storage vector indexing.
