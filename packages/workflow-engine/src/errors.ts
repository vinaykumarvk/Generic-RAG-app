export class WorkflowError extends Error {
  constructor(
    message: string,
    public readonly errorCode: string
  ) {
    super(message);
    this.name = "WorkflowError";
  }
}

export class TransitionError extends WorkflowError {
  constructor(message: string, errorCode: string) {
    super(message, errorCode);
    this.name = "TransitionError";
  }
}

export class GuardError extends WorkflowError {
  constructor(
    message: string,
    errorCode: string,
    public readonly guardType: string
  ) {
    super(message, errorCode);
    this.name = "GuardError";
  }
}

export class ConfigError extends WorkflowError {
  constructor(message: string) {
    super(message, "CONFIG_INVALID");
    this.name = "ConfigError";
  }
}
