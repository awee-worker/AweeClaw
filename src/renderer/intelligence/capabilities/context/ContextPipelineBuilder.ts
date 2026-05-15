/**
 * Context Pipeline Builder
 */
export interface PipelineStage {
  name: string
  process: (input: unknown) => unknown
}

export class ContextPipelineBuilder {
  private stages: PipelineStage[] = []

  addStage(stage: PipelineStage): this {
    this.stages.push(stage)
    return this
  }

  build(): PipelineStage[] {
    return [...this.stages]
  }

  reset(): this {
    this.stages = []
    return this
  }
}
