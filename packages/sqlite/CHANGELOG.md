# @workglow/sqlite

## 0.0.90

### Patch Changes

- Introduce Loop tasks: Map, Reduce, and While

## 0.0.89

### Patch Changes

- Fix subgraph reactive

## 0.0.88

### Patch Changes

- Revert adding loop tasks, push other fixes

## 0.0.87

### Patch Changes

- bad version with loop not ready for prime time

## 0.0.86

### Patch Changes

- Add concept of Datasets, rename all storage class in storage to end in storage, added some RAG tasks

## 0.0.85

### Patch Changes

- Add FileLoaderTask and Ai tasks can use model config directly

## 0.0.84

### Patch Changes

- Fix model lookup for named entity rec

## 0.0.83

### Patch Changes

- Update definitions for secondary key array as const

## 0.0.82

### Patch Changes

- Small updates for model definitions and repo

## 0.0.81

### Patch Changes

- Fix mediapipe download for vision models

## 0.0.80

### Patch Changes

- Renamed FetchTask to FetchUrlTask, and camelCased the workflow methods, all breaking changes

## 0.0.79

### Patch Changes

- Merge and Split

## 0.0.78

### Patch Changes

- Added Input and Output tasks and rewrote deleteSearch to not be lame

## 0.0.77

### Patch Changes

- semantic compat via format should allow dashes

## 0.0.76

### Patch Changes

- fix array task reactive

## 0.0.75

### Patch Changes

- Change priority order for image transfer across workers

## 0.0.74

### Patch Changes

- Another attempt at transferables

## 0.0.73

### Patch Changes

- Fix serious bug that made ai tasks fail

## 0.0.72

### Patch Changes

- Add Vision/Image tasks

## 0.0.71

### Patch Changes

- Add TextFillMaskTask and TextNamedEntityRecognitionTask

## 0.0.70

### Patch Changes

- Updates to download progress, etc

## 0.0.69

### Patch Changes

- Fix build

## 0.0.68

### Patch Changes

- Fix missing unload model task in worker version

## 0.0.67

### Patch Changes

- Add new tasks: UnloadModelTask, TextClassifierTask, TextLanguageDetectionTask

## 0.0.66

### Patch Changes

- Subscriptions for all tabular repositories

## 0.0.65

### Patch Changes

- Add a subscription to task graph for child progress events

## 0.0.64

### Patch Changes

- Fix indexeddb queue to not mark completed on every progress message which made it look like it was retrying

## 0.0.63

### Patch Changes

- Fix more max try issues

## 0.0.62

### Patch Changes

- Update the queue system with fixes around max retries

## 0.0.61

### Patch Changes

- Update model config bugs with narrowing

## 0.0.60

### Patch Changes

- Rework and simplify the model repo

## 0.0.59

### Patch Changes

- Rework model config

## 0.0.58

### Patch Changes

- Refactored the lame job queue into a less lame job queue

## 0.0.57

### Patch Changes

- Change JSON formats to use property name defaults instead of input

## 0.0.56

### Patch Changes

- Update TaskGraph to add subscriptions for status changes for tasks and dataflows

## 0.0.55

### Patch Changes

- Update deps

## 0.0.54

### Patch Changes

- Update output shcema on input changes for FetchTask

## 0.0.53

### Patch Changes

- Update FetchTask to use dynamic output schema

## 0.0.52

### Patch Changes

- First release under "workglow" naming
