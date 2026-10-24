import { HStack, Capsule, Image, RoundedRectangle, ScrollView, Spacer, Text, TextField, VStack, ZStack, useEffect, useState } from "scripting"

import { capsule, dialog, palette, radius, rect } from "../design/tokens"
import {
  activeCustomDialog,
  dismissCustomDialog,
  finishCustomDialog,
  subscribeCustomDialog,
  type CustomDialogRequest,
} from "./customDialog"
import { t } from "../i18n"
import { useTint } from "./theme"

export function CustomDialogOverlay() {
  const [request, setRequest] = useState<CustomDialogRequest | undefined>(activeCustomDialog())

  useEffect(() => {
    setRequest(activeCustomDialog())
    return subscribeCustomDialog(() => setRequest(activeCustomDialog()))
  }, [])

  if (!request) return null

  return (
    <ZStack frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      {/* 遮罩：只有遮罩沒有陰影，卡片靠它跟頁面分開 */}
      <VStack
        frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
        background={dialog.scrim}
        onTapGesture={() => dismissCustomDialog()}
      />
      <DialogCard key={request.id} request={request} />
    </ZStack>
  )
}

/** 卡片本體。匯出只為了藝廊直畫三種卡片（不改對外行為）。 */
export function DialogCard({ request }: { request: CustomDialogRequest }) {
  // 修飾符順序不能換：background → clipShape → glassEffect → overlay，
  // background 才會被裁進圓角、不溢出四個直角。
  return (
    <VStack
      spacing={0}
      frame={{ width: 270 }}
      background={dialog.card}
      clipShape={rect(radius.xl)}
      glassEffect={{ glass: UIGlass.regular(), shape: rect(radius.xl) }}
      overlay={<RoundedRectangle cornerRadius={radius.xl} stroke={dialog.cardBorder} />}
    >
      {request.kind === "input" ? <InputDialog request={request} /> : null}
      {request.kind === "message" ? <MessageDialog request={request} /> : null}
      {request.kind === "select" ? <SelectDialog request={request} /> : null}
    </VStack>
  )
}

/** 膠囊按鈕：預設（role default）用 tint 實心底；取消與破壞性維持微透底。 */
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
  const tint = useTint()
  const isDefault = role === "default"
  const textColor = role === "destructive" ? palette.red : "label"

  return (
    <HStack
      alignment="center"
      frame={{ width, height: 44 }}
      background={isDefault ? tint.tint : dialog.button}
      clipShape={capsule()}
      overlay={isDefault ? undefined : <Capsule stroke={dialog.buttonBorder} />}
      onTapGesture={onTap}
    >
      <Spacer />
      <Text
        font="body"
        fontWeight={isDefault ? "semibold" : "regular"}
        foregroundStyle={isDefault ? tint.onTint : textColor}
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

  useEffect(() => {
    setValue("")
    setError("")
  }, [request.id])

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
            background={dialog.inset}
            clipShape={rect(radius.md)}
            overlay={<RoundedRectangle cornerRadius={radius.md} stroke={dialog.insetBorder} />}
            frame={{ width: 242 }}
          >
            <Image
              imageUrl={request.image}
              resizable
              scaleToFit
              clipShape={rect(radius.sm)}
              frame={{ maxHeight: 90 }}
            />
          </VStack>
        ) : null}
        {request.image && typeof request.image !== "string" ? (
          <VStack
            alignment="center"
            padding={4}
            background={dialog.inset}
            clipShape={rect(radius.md)}
            overlay={<RoundedRectangle cornerRadius={radius.md} stroke={dialog.insetBorder} />}
            frame={{ width: 242 }}
          >
            <Image
              image={request.image}
              resizable
              scaleToFit
              clipShape={rect(radius.sm)}
              frame={{ maxHeight: 90 }}
            />
          </VStack>
        ) : null}

        {/* 原生風格輸入框 */}
        <HStack
          alignment="center"
          padding={{ horizontal: 10, vertical: 7 }}
          background={dialog.field}
          clipShape={rect(radius.md)}
          overlay={<RoundedRectangle cornerRadius={radius.md} stroke={dialog.fieldBorder} />}
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
