import { HStack, Image, RoundedRectangle, ScrollView, Spacer, Text, TextField, VStack, ZStack, useEffect, useState } from "scripting"

import { palette, rect } from "../design/tokens"
import {
  activeCustomDialog,
  dismissCustomDialog,
  finishCustomDialog,
  subscribeCustomDialog,
  type CustomDialogRequest,
} from "./customDialog"
import { t } from "../i18n"

export function CustomDialogOverlay() {
  const [request, setRequest] = useState<CustomDialogRequest | undefined>(activeCustomDialog())

  useEffect(() => {
    setRequest(activeCustomDialog())
    return subscribeCustomDialog(() => setRequest(activeCustomDialog()))
  }, [])

  if (!request) return null

  return (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      {/* 遮罩背景：自適應深淺色 */}
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        background={{
          dark: "rgba(0, 0, 0, 0.42)",
          light: "rgba(0, 0, 0, 0.28)",
        }}
        onTapGesture={() => dismissCustomDialog()}
      />
      <DialogCard request={request} />
    </ZStack>
  )
}

function DialogCard({ request }: { request: CustomDialogRequest }) {
  // 原生 iOS Alert (深/淺色模式自適應)：
  // 1. 卡片寬度：270pt，圓角 22pt
  // 2. 修正修飾符順序：
  //    先 background -> 再 clipShape -> 最後 glassEffect / overlay / shadow
  //    保證 background 矩形完全被 clipShape 裁切，絕不溢出四個直角！
  return (
    <VStack
      spacing={0}
      frame={{ width: 270 }}
      background={{
        dark: {
          colors: ["rgba(42, 42, 46, 0.72)", "rgba(24, 24, 26, 0.78)"],
          startPoint: "top",
          endPoint: "bottom",
        },
        light: {
          colors: ["rgba(255, 255, 255, 0.78)", "rgba(242, 242, 247, 0.84)"],
          startPoint: "top",
          endPoint: "bottom",
        },
      }}
      clipShape={rect(22)}
      glassEffect={{ glass: UIGlass.regular(), shape: rect(22) }}
      overlay={
        <RoundedRectangle
          cornerRadius={22}
          stroke={{
            dark: {
              colors: ["rgba(255, 255, 255, 0.28)", "rgba(255, 255, 255, 0.08)"],
              startPoint: "top",
              endPoint: "bottom",
            },
            light: {
              colors: ["rgba(255, 255, 255, 0.85)", "rgba(0, 0, 0, 0.08)"],
              startPoint: "top",
              endPoint: "bottom",
            },
          }}
        />
      }
      shadow={{
        color: "rgba(0, 0, 0, 0.28)",
        radius: 32,
        x: 0,
        y: 12,
      }}
    >
      {request.kind === "input" ? <InputDialog request={request} /> : null}
      {request.kind === "message" ? <MessageDialog request={request} /> : null}
      {request.kind === "select" ? <SelectDialog request={request} /> : null}
    </VStack>
  )
}

/** 
 * 原生 iOS 彈窗膠囊按鈕：
 * - 深色模式：微透白膠囊（rgba(255, 255, 255, 0.16)）+ 白字
 * - 淺色模式：微透黑/灰膠囊（rgba(0, 0, 0, 0.06)）+ 深灰/黑字
 */
function NativeAlertButton({
  title,
  role,
  width = 116,
  onTap,
}: {
  title: string
  role?: "destructive" | "cancel" | "default"
  width?: number
  onTap: () => void
}) {
  const textColor = role === "destructive" ? palette.red : "label"
  const isBold = role === "default"

  return (
    <HStack
      alignment="center"
      frame={{ width, height: 44 }}
      background={{
        dark: "rgba(255, 255, 255, 0.16)",
        light: "rgba(0, 0, 0, 0.06)",
      }}
      clipShape={rect(22)}
      overlay={
        <RoundedRectangle
          cornerRadius={22}
          stroke={{
            dark: "rgba(255, 255, 255, 0.08)",
            light: "rgba(0, 0, 0, 0.04)",
          }}
        />
      }
      onTapGesture={onTap}
    >
      <Spacer />
      <Text
        font="body"
        fontWeight={isBold ? "semibold" : "regular"}
        foregroundStyle={textColor}
      >
        {title}
      </Text>
      <Spacer />
    </HStack>
  )
}

// ── Input Dialog ─────────────────────────────────────────────────────────

function InputDialog({ request }: { request: Extract<CustomDialogRequest, { kind: "input" }> }) {
  const [value, setValue] = useState("")
  const [error, setError] = useState("")

  function submit() {
    try {
      const problem = request.validate?.(value)
      if (problem) {
        setError(String(problem))
        return
      }
      finishCustomDialog(request, value)
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown))
    }
  }

  return (
    <VStack spacing={0} frame={{ width: 270 }}>
      {/* 上方內容 */}
      <VStack
        spacing={14}
        padding={{ top: 20, leading: 14, trailing: 14, bottom: 16 }}
        frame={{ width: 270 }}
      >
        <Text
          font="headline"
          fontWeight="bold"
          multilineTextAlignment="center"
          foregroundStyle="label"
          frame={{ width: 242 }}
        >
          {request.title}
        </Text>

        {typeof request.image === "string" ? (
          <VStack
            alignment="center"
            padding={4}
            background={{
              dark: "rgba(0, 0, 0, 0.25)",
              light: "rgba(0, 0, 0, 0.04)",
            }}
            clipShape={rect(8)}
            overlay={
              <RoundedRectangle
                cornerRadius={8}
                stroke={{
                  dark: "rgba(255, 255, 255, 0.08)",
                  light: "rgba(0, 0, 0, 0.08)",
                }}
              />
            }
            frame={{ width: 242 }}
          >
            <Image
              imageUrl={request.image}
              resizable
              scaleToFit
              clipShape={rect(6)}
              frame={{ maxHeight: 90 }}
            />
          </VStack>
        ) : null}
        {request.image && typeof request.image !== "string" ? (
          <VStack
            alignment="center"
            padding={4}
            background={{
              dark: "rgba(0, 0, 0, 0.25)",
              light: "rgba(0, 0, 0, 0.04)",
            }}
            clipShape={rect(8)}
            overlay={
              <RoundedRectangle
                cornerRadius={8}
                stroke={{
                  dark: "rgba(255, 255, 255, 0.08)",
                  light: "rgba(0, 0, 0, 0.08)",
                }}
              />
            }
            frame={{ width: 242 }}
          >
            <Image
              image={request.image}
              resizable
              scaleToFit
              clipShape={rect(6)}
              frame={{ maxHeight: 90 }}
            />
          </VStack>
        ) : null}

        {/* 原生風格輸入框 */}
        <HStack
          alignment="center"
          padding={{ horizontal: 10, vertical: 7 }}
          background={{
            dark: "rgba(0, 0, 0, 0.35)",
            light: "rgba(0, 0, 0, 0.05)",
          }}
          clipShape={rect(8)}
          overlay={
            <RoundedRectangle
              cornerRadius={8}
              stroke={{
                dark: "rgba(255, 255, 255, 0.12)",
                light: "rgba(0, 0, 0, 0.1)",
              }}
            />
          }
          frame={{ width: 242 }}
        >
          <TextField
            title=""
            prompt={t("common.input")}
            value={value}
            autofocus
            textFieldStyle="plain"
            onSubmit={submit}
            onChanged={next => {
              setValue(next)
              if (error) setError("")
            }}
          />
        </HStack>

        {error ? (
          <Text font="caption" foregroundStyle={palette.red} multilineTextAlignment="center" frame={{ width: 242 }}>
            {error}
          </Text>
        ) : null}
      </VStack>

      {/* 底部按鈕列：寬度 242，左右雙按鈕各 116，間距 10，完全撐滿底線 */}
      <HStack
        spacing={10}
        padding={{ leading: 14, trailing: 14, bottom: 14 }}
        frame={{ width: 270 }}
      >
        <NativeAlertButton
          title={t("common.cancel")}
          role="cancel"
          width={116}
          onTap={() => dismissCustomDialog()}
        />
        <NativeAlertButton
          title={t("common.confirm")}
          role="default"
          width={116}
          onTap={submit}
        />
      </HStack>
    </VStack>
  )
}

// ── Message Dialog ───────────────────────────────────────────────────────

function MessageDialog({ request }: { request: Extract<CustomDialogRequest, { kind: "message" }> }) {
  async function choose(action: (typeof request.actions)[number]) {
    finishCustomDialog(request, null)
    if (action.callback) await action.callback()
  }

  const isTwoButtons = request.actions.length === 2

  return (
    <VStack spacing={0} frame={{ width: 270 }}>
      <VStack
        spacing={8}
        padding={{ top: 20, leading: 14, trailing: 14, bottom: 16 }}
        frame={{ width: 270 }}
      >
        <Text
          font="headline"
          fontWeight="bold"
          multilineTextAlignment="center"
          foregroundStyle="label"
          frame={{ width: 242 }}
        >
          {request.title}
        </Text>

        {request.content ? (
          <ScrollView frame={{ maxHeight: 220 }}>
            <Text
              font="subheadline"
              foregroundStyle="secondaryLabel"
              multilineTextAlignment="center"
              frame={{ width: 242 }}
            >
              {request.content}
            </Text>
          </ScrollView>
        ) : null}
      </VStack>

      {isTwoButtons ? (
        <HStack
          spacing={10}
          padding={{ leading: 14, trailing: 14, bottom: 14 }}
          frame={{ width: 270 }}
        >
          {request.actions.map((action, index) => (
            <NativeAlertButton
              key={`${action.text}-${index}`}
              title={action.text}
              width={116}
              role={action.destructive ? "destructive" : index === 0 ? "cancel" : "default"}
              onTap={() => void choose(action)}
            />
          ))}
        </HStack>
      ) : (
        <VStack
          spacing={8}
          padding={{ leading: 14, trailing: 14, bottom: 14 }}
          frame={{ width: 270 }}
        >
          {request.actions.map((action, index) => (
            <NativeAlertButton
              key={`${action.text}-${index}`}
              title={action.text}
              width={242}
              role={action.destructive ? "destructive" : "default"}
              onTap={() => void choose(action)}
            />
          ))}
        </VStack>
      )}
    </VStack>
  )
}

// ── Select Dialog ────────────────────────────────────────────────────────

function SelectDialog({ request }: { request: Extract<CustomDialogRequest, { kind: "select" }> }) {
  return (
    <VStack spacing={0} frame={{ width: 270 }}>
      <VStack
        spacing={8}
        padding={{ top: 20, leading: 14, trailing: 14, bottom: 14 }}
        frame={{ width: 270 }}
      >
        <Text
          font="headline"
          fontWeight="bold"
          multilineTextAlignment="center"
          foregroundStyle="label"
          frame={{ width: 242 }}
        >
          {request.title}
        </Text>
      </VStack>

      <VStack
        spacing={8}
        padding={{ leading: 14, trailing: 14, bottom: 14 }}
        frame={{ width: 270 }}
      >
        <ScrollView frame={{ maxHeight: 260 }}>
          <VStack spacing={8} frame={{ width: 242 }}>
            {request.options.map((option, index) => (
              <NativeAlertButton
                key={`${option}-${index}`}
                title={option}
                width={242}
                role={index === request.initialIndex ? "default" : "cancel"}
                onTap={() => finishCustomDialog(request, index)}
              />
            ))}
          </VStack>
        </ScrollView>

        <NativeAlertButton
          title={t("common.cancel")}
          role="cancel"
          width={242}
          onTap={() => dismissCustomDialog()}
        />
      </VStack>
    </VStack>
  )
}
