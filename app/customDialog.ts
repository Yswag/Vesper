import { createEmitter } from "../engine/emitter"

import type { PromptRequest } from "./PromptSheet"

export interface DialogAction {
  text: string
  destructive?: boolean
  callback?: () => unknown
}

export type CustomDialogRequest =
  | {
      id: number
      kind: "message"
      title: string
      content: string
      actions: DialogAction[]
      resolve: () => void
    }
  | {
      id: number
      kind: "input"
      title: string
      image?: string | UIImage | null
      validate?: PromptRequest["validate"]
      resolve: (value: string | null) => void
    }
  | {
      id: number
      kind: "select"
      title: string
      options: string[]
      initialIndex?: number
      resolve: (value: number | null) => void
    }

let nextDialogId = 1
let queue: CustomDialogRequest[] = []

const bus = createEmitter()

export function activeCustomDialog(): CustomDialogRequest | undefined {
  return queue[0]
}

export const subscribeCustomDialog = bus.subscribe

function enqueue(request: Omit<CustomDialogRequest, "id">) {
  const item = { ...request, id: nextDialogId++ } as CustomDialogRequest
  queue = queue.concat(item)
  bus.emit()
}

export function dismissCustomDialog() {
  const request = queue.shift()
  if (!request) return
  if (request.kind === "input") request.resolve(null)
  if (request.kind === "select") request.resolve(null)
  if (request.kind === "message") request.resolve()
  bus.emit()
}

export function finishCustomDialog(request: CustomDialogRequest, value: string | number | null) {
  if (queue[0] !== request) return
  queue.shift()
  if (request.kind === "input") request.resolve(typeof value === "string" ? value : null)
  if (request.kind === "select") request.resolve(typeof value === "number" ? value : null)
  if (request.kind === "message") request.resolve()
  bus.emit()
}

export function presentCustomInput(
  request: Omit<Extract<CustomDialogRequest, { kind: "input" }>, "id" | "kind" | "resolve">,
): Promise<string | null> {
  return new Promise(resolve => enqueue({ kind: "input", ...request, resolve }))
}

export function presentCustomMessage(
  request: Omit<Extract<CustomDialogRequest, { kind: "message" }>, "id" | "kind" | "resolve">,
): Promise<void> {
  return new Promise(resolve => enqueue({ kind: "message", ...request, resolve }))
}

export function presentCustomSelect(
  request: Omit<Extract<CustomDialogRequest, { kind: "select" }>, "id" | "kind" | "resolve">,
): Promise<number | null> {
  return new Promise(resolve => enqueue({ kind: "select", ...request, resolve }))
}
