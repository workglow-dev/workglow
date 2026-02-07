import { Task } from "@workglow/task-graph";
import { describe, expect, it } from "vitest";

import { TaskCreatorTask } from "./TestTasks";

describe("Task own functionality", () => {
  describe("TaskCreatorTask", () => {
    it("should add created tasks to subgraph during execution", async () => {
      const task = new TaskCreatorTask();

      // Initially the subgraph should be empty
      expect(task.hasChildren()).toBe(false);

      // Run the task which will create and own other tasks
      await task.run();

      // Now the subgraph should have tasks
      expect(task.hasChildren()).toBe(true);

      // Should have 3 tasks in subgraph:
      // 1. Direct Task
      // 2. TaskGraph wrapped in GraphAsTask
      // 3. Workflow graph wrapped in GraphAsTask
      expect(task.subGraph.getTasks().length).toBe(3);
    });

    it("should properly wrap TaskGraph and Workflow in GraphAsTask", async () => {
      const task = new TaskCreatorTask();
      await task.run();

      const subTasks = task.subGraph.getTasks();

      // First task should be a direct Task instance
      expect(subTasks[0]).toBeInstanceOf(Task);

      // Second and third tasks should be GraphAsTask instances
      expect(subTasks[1].type).toBe("Own[Graph]");
      expect(subTasks[2].type).toBe("Own[Workflow]");

      // Verify the wrapped graphs have their tasks
      expect(subTasks[1].hasChildren()).toBe(true);
      expect(subTasks[2].hasChildren()).toBe(true);
    });
  });
});
