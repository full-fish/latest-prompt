# latest-prompt

Claude Code 입력창 바로 위에 내가 보낸 질문을 한 줄로 고정해 보여주는 플러그인입니다. 대화가 길어져 질문이 화면 밖으로 밀려나도, 지금 Claude가 무엇에 답하고 있는지 바로 확인할 수 있습니다.

## 동작

- 기본으로 가장 최근에 보낸 질문을 입력창 위에 구분선과 함께 한 줄로 보여줍니다. 터미널 너비보다 길면 `…`로 줄입니다.
- 전체 화면(fullscreen) 모드에서 대화를 위로 스크롤하면, 지금 화면에 보이는 부분에 해당하는 질문으로 바뀝니다.
- 질문 줄을 누르면 전체 내용을 펼치고, 다시 누르면 한 줄로 접습니다.
- 슬래시 명령(`/model` 등), 시스템 메시지, 다른 세션에서 온 메시지는 질문으로 치지 않습니다.
- `/clear`나 `/resume`으로 대화가 바뀌면 비우고, 세션을 다시 열면 기록에서 마지막 질문을 찾아 보여줍니다.
- 데스크톱 앱에서도 동작합니다.

## 설치

```
/plugin marketplace add full-fish/latest-prompt
/plugin install latest-prompt@latest-prompt
```

설치 후 Claude Code를 다시 시작하면 적용됩니다.

## 단축키로 펼치기 (선택)

질문 줄은 `app:cycleDiffBase` 동작을 받으면 펼치고 접힙니다. 키보드로 쓰려면 `~/.claude/keybindings.json`에 아래처럼 단축키를 연결하세요. 이미 쓰고 있는 조합이면 다른 키로 바꿔도 됩니다.

```json
{
  "bindings": [
    {
      "context": "Chat",
      "bindings": {
        "ctrl+x ctrl+a": "app:cycleDiffBase"
      }
    }
  ]
}
```

## 라이선스

[MIT](LICENSE) © fullfish
