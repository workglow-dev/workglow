TODO.md

- [ ] Chunks and nodes are not the same.
  - [ ] We need to rename the files related to embedding.
  - [ ] And we may need to save the chunk's node path. Or paths?
- [ ] Get a better model for question answering.
- [ ] Get a better model for named entity recognition, the current one recognized everything as a token, not helpful.
- [ ] Titles are not making it into the chunks.
- [ ] Tests for CLI commands.

- [ ] Add ability for queues to specify if inputs should be converted to text, binary blob, a transferable object, structured clone, or just passed as is.
- [ ] Add specialized versions of the task queues for hugging face transformers and tensorflow mediapipe.
- [ ] Audio conversion like the image conversion
- [ ] rename the registration stuff to not look ugly: registerHuggingfaceTransformers() and registerHuggingfaceTransformersUsingWorkers() and registerHuggingfaceTransformersInsideWorker()
- [ ] fix image transferables
