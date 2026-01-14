TODO.md

- [x] Rename repositories in the packages/storage to use the word Storage instead of Repository.
- [ ] Vector Storage (not chunk storage)
  - [ ] Rename the files from packages/storage/src/vector-storage to packages/storage/src/vector
  - [ ] No fixed column names, use the schema to define the columns.
  - [ ] Option for which column to use if there are multiple, default to the first one.
  - [ ] Use @mceachen/sqlite-vec for sqlite storage.
- [ ] Datasets Package
  - [ ] Documents repository (mabye rename to DocumentDataset)
  - [ ] Chunks repository (maybe rename to ChunkDataset) or DocumentChunksDataset? Or just part of DocumentDataset? Or is it a new thing?
  - [ ] Move Model repository to datasets package.
- [ ] Chunk Repository
  - [ ] Add to packages/tasks or packages/ai
  - [ ] Model like Model repository (although that just has one)
  - [ ] Model even closer to Document repositories
- [ ] Chunks and nodes are not always the same.
  - [ ] And we may need to save the chunk's node path. Or paths? or document range? Standard metadata?
- [ ] Use Repository to always envelope the storage operations (for transactions, dealing with IDs, etc).

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
