import type { ElementDeclaration, Particle } from './schema-model.js'

interface Transition {
  to: number
  element?: ElementDeclaration
}
type State = readonly number[]

export class ContentModel {
  private readonly graph: Transition[][] = []
  private readonly end: number
  readonly start: State
  readonly members: ReadonlyMap<string, ElementDeclaration>

  constructor(particle?: Particle) {
    const start = this.node()
    this.end = this.node()
    if (particle) this.particle(particle, start, this.end)
    else this.connect(start, this.end)
    this.start = this.closure([start])
    this.members = new Map(
      this.graph.flatMap((edges) =>
        edges.flatMap(({ element }) => (element ? [[element.name, element] as const] : [])),
      ),
    )
  }

  private node(): number {
    return this.graph.push([]) - 1
  }

  private connect(from: number, to: number, element?: ElementDeclaration): void {
    this.graph[from]!.push({ to, element })
  }

  private particle(particle: Particle, start: number, end: number): void {
    let from = start
    for (let i = 0; i < particle.min; i++) {
      const next = this.node()
      this.unit(particle, from, next)
      from = next
    }
    if (particle.max === null) {
      this.connect(from, end)
      const next = this.node()
      this.unit(particle, from, next)
      this.connect(next, from)
      return
    }
    for (let i = particle.min; i < particle.max; i++) {
      this.connect(from, end)
      const next = this.node()
      this.unit(particle, from, next)
      from = next
    }
    this.connect(from, end)
  }

  private unit(particle: Particle, start: number, end: number): void {
    if (particle.kind === 'element') {
      this.connect(start, end, particle.element)
    } else if (particle.kind === 'choice') {
      for (const child of particle.children) this.particle(child, start, end)
    } else if (particle.kind === 'all') {
      const states = [
        start,
        ...Array.from({ length: (1 << particle.children.length) - 1 }, () => this.node()),
      ]
      const required = particle.children.reduce(
        (mask, child, i) => mask | (child.min > 0 ? 1 << i : 0),
        0,
      )
      for (const [mask, state] of states.entries()) {
        if ((mask & required) === required) this.connect(state, end)
        for (const [i, child] of particle.children.entries()) {
          if ((mask & (1 << i)) === 0 && child.kind === 'element') {
            this.connect(state, states[mask | (1 << i)]!, child.element)
          }
        }
      }
    } else {
      let from = start
      for (const child of particle.children) {
        const next = this.node()
        this.particle(child, from, next)
        from = next
      }
      this.connect(from, end)
    }
  }

  private closure(nodes: number[]): State {
    const seen = new Set(nodes)
    for (const state of seen) {
      for (const edge of this.graph[state]!) if (!edge.element) seen.add(edge.to)
    }
    return [...seen]
  }

  advance(state: State, name: string): State {
    const nodes: number[] = []
    for (const from of state) {
      for (const edge of this.graph[from]!) if (edge.element?.name === name) nodes.push(edge.to)
    }
    return this.closure(nodes)
  }

  candidates(state: State): ElementDeclaration[] {
    const result = new Map<string, ElementDeclaration>()
    for (const from of state) {
      for (const edge of this.graph[from]!)
        if (edge.element) result.set(edge.element.name, edge.element)
    }
    return [...result.values()]
  }

  accepts(state: State): boolean {
    return state.includes(this.end)
  }
}
