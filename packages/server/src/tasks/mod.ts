/**
 * Public API for the Tasks extension (io.modelcontextprotocol/tasks, SEP-2663).
 *
 * Tool handlers use `createTask()` to opt into async-task mode.
 * The transport layer uses `TaskStore` to manage task lifecycle.
 * `isAsyncTaskDescriptor()` is the discriminant the framework uses at the
 * tools/call boundary to decide whether to spawn a task or return a result.
 *
 * @module lib/server/tasks
 */

export type {
  AsyncTaskDescriptor,
  CancelledTask,
  CompletedTask,
  CreateTaskOptions,
  CreateTaskResultFields,
  DetailedTask,
  FailedTask,
  InputRequest,
  InputRequiredTask,
  Task,
  TaskController,
  TaskStoreOptions,
  WorkingTask,
} from "./task-store.ts";

export {
  createTask,
  generateTaskId,
  isAsyncTaskDescriptor,
  TaskStore,
} from "./task-store.ts";
