TODO.md

- [ ] Get a better model for question answering.
- [ ] Get a better model for named entity recognition, the current one recognized everything as a token, not helpful.
      onnx-community/ModernBERT-finetuned-squad-ONNX - summarization

- [ ] Audio conversion like the image conversion
- [ ] rename the registration stuff to not look ugly: registerHuggingfaceTransformers() and registerHuggingfaceTransformersUsingWorkers() and registerHuggingfaceTransformersInsideWorker()
- [ ] fix image transferables

- [ ] Consider different ways to connect tasks to queues. What is a task? What is a job?

Next steps:

- AI agent compound task: AI agent would use browser tasks as tools, and could crystallize  
  its actions into a fixed workflow. Design BrowserAgentTask (the compound task  
  that wraps an LLM + browser tools)
