import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ApiRequestError, login } from "../api/client.js";
import { errorMessage } from "../lib/errors.js";
import { AMBER, BAD, backgroundGrid, CHAKRA, DIM, HI } from "../lib/theme.js";

export function LoginScreen() {
  const queryClient = useQueryClient();
  const [key, setKey] = useState("");

  const mutation = useMutation({
    mutationFn: () => login(key),
    onSuccess: () => {
      queryClient.setQueryData(["auth", "me"], { authenticated: true });
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!key || mutation.isPending) return;
    mutation.mutate();
  }

  let error = "";
  if (mutation.isError) {
    if (
      mutation.error instanceof ApiRequestError &&
      mutation.error.status === 429
    ) {
      error = "▸ TOO MANY ATTEMPTS — TRY AGAIN LATER";
    } else if (
      mutation.error instanceof ApiRequestError &&
      mutation.error.status === 401
    ) {
      error = "▸ ACCESS DENIED";
    } else {
      error = `▸ ${errorMessage(mutation.error).toUpperCase()}`;
    }
  }

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: HI,
        ...backgroundGrid,
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: "min(360px, 92vw)",
          border: "1px solid rgba(255,179,71,.22)",
          background: "rgba(14,17,24,.8)",
          padding: "34px 30px 28px",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "20px",
            height: "20px",
            borderTop: "2px solid #ffb347",
            borderLeft: "2px solid #ffb347",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: 0,
            right: 0,
            width: "20px",
            height: "20px",
            borderBottom: "2px solid #ffb347",
            borderRight: "2px solid #ffb347",
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "12px",
            marginBottom: "28px",
          }}
        >
          <div style={{ position: "relative", width: "42px", height: "42px" }}>
            <div
              style={{
                position: "absolute",
                inset: 0,
                border: "1.5px solid #ffb347",
                transform: "rotate(45deg)",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: "11px",
                background: "#ffb347",
                transform: "rotate(45deg)",
                boxShadow: "0 0 14px rgba(255,179,71,.7)",
                animation: "flick 3s ease-in-out infinite",
              }}
            />
          </div>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontFamily: CHAKRA,
                fontWeight: 700,
                fontSize: "20px",
                letterSpacing: ".3em",
              }}
            >
              HOLONET
            </div>
            <div
              style={{
                fontSize: "8.5px",
                letterSpacing: ".34em",
                color: DIM,
                marginTop: "5px",
              }}
            >
              OPS CONSOLE · v2.6
            </div>
          </div>
        </div>

        <label
          htmlFor="access-key"
          style={{
            display: "block",
            fontSize: "9px",
            letterSpacing: ".26em",
            color: DIM,
            marginBottom: "8px",
          }}
        >
          ACCESS KEY
        </label>
        <input
          id="access-key"
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="••••••••••••"
          style={{
            width: "100%",
            background: "rgba(140,160,190,.05)",
            border: `1px solid ${error ? BAD : "rgba(140,160,190,.2)"}`,
            color: HI,
            fontFamily: CHAKRA,
            fontWeight: 600,
            fontSize: "14px",
            letterSpacing: ".14em",
            padding: "12px 13px",
          }}
        />
        <div
          style={{
            fontSize: "9px",
            letterSpacing: ".1em",
            color: BAD,
            marginTop: "8px",
            minHeight: "11px",
          }}
        >
          {error}
        </div>

        <button
          type="submit"
          disabled={!key || mutation.isPending}
          style={{
            width: "100%",
            marginTop: "20px",
            background: AMBER,
            color: "#0a0c10",
            border: "none",
            padding: "12px 22px",
            fontFamily: CHAKRA,
            fontWeight: 700,
            fontSize: "11px",
            letterSpacing: ".18em",
            cursor: !key || mutation.isPending ? "not-allowed" : "pointer",
            opacity: !key || mutation.isPending ? 0.6 : 1,
            boxShadow: "0 0 18px rgba(255,179,71,.35)",
          }}
        >
          {mutation.isPending ? "AUTHENTICATING…" : "DEPLOY SESSION"}
        </button>
      </form>
    </div>
  );
}
