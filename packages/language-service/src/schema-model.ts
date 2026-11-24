export interface ElementDeclaration {
  name: string
  type: string
  documentation?: string
}

export interface AttributeDeclaration extends ElementDeclaration {
  required: boolean
  default?: string
  fixed?: string
}

export interface SimpleType {
  base: 'string' | 'token'
  values?: string[]
  minLength?: number
  documentation?: string
}

export type Particle = { min: number; max: number | null } & (
  | { kind: 'element'; element: ElementDeclaration }
  | { kind: 'sequence' | 'choice' | 'all'; children: Particle[] }
)

export interface ComplexType {
  content?: Particle
  text?: string
  mixed: boolean
  attributes: AttributeDeclaration[]
  anyAttribute: boolean
  documentation?: string
}

export interface SchemaModel {
  source: string
  version: string
  hash: string
  documentation?: string
  roots: ElementDeclaration[]
  simpleTypes: Record<string, SimpleType>
  complexTypes: Record<string, ComplexType>
}
