TODO.md

- [x] Rename repositories in the packages/storage to use the word Storage instead of Repository.
- [ ] Vector Storage (not chunk storage)
  - [x] Rename the files from packages/storage/src/vector-storage to packages/storage/src/vector
  - [x] No fixed column names, use the schema to define the columns.
  - [ ] Option for which column to use if there are multiple, default to the first one.
  - [ ] Use @mceachen/sqlite-vec for sqlite storage.
- [x] Chunks and nodes are not always the same.
  - [x] And we may need to save the chunk's node path. Or paths? or document range? Standard metadata?
  - [ ] Instead of passing doc_id around, pass a document key that is of type unknown (string or object)

- [ ] Get a better model for question answering.
- [ ] Get a better model for named entity recognition, the current one recognized everything as a token, not helpful.
- [ ] Titles are not making it into the chunks.
- [ ] Tests for CLI commands.

- [ ] Add ability for queues to specify if inputs should be converted to text, binary blob, a transferable object, structured clone, or just passed as is.
- [ ] Add specialized versions of the task queues for hugging face transformers and tensorflow mediapipe.
- [ ] Audio conversion like the image conversion
- [ ] rename the registration stuff to not look ugly: registerHuggingfaceTransformers() and registerHuggingfaceTransformersUsingWorkers() and registerHuggingfaceTransformersInsideWorker()
- [ ] fix image transferables

- [ ] Consider different ways to connect tasks to queues. What is a task? What is a job?

onnx-community/ModernBERT-finetuned-squad-ONNX - summarization

The sqlitevectorstorage currently does not use a built in vector search. Use @mceachen/sqlite-vec for sqlite storage vector indexing.
