import { useQuery } from "@tanstack/react-query";
import { authMeQueryOptions } from "./api/client.js";
import { Console } from "./components/Console.js";
import { LoginScreen } from "./components/LoginScreen.js";
import { backgroundGrid, CHAKRA, DIM } from "./lib/theme.js";

export function App() {
  const meQuery = useQuery(authMeQueryOptions);

  if (meQuery.isLoading) {
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "10px",
          color: "#e9edf4",
          fontFamily: CHAKRA,
          letterSpacing: "0.24em",
          ...backgroundGrid,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: "16px" }}>HOLONET</div>
        <div
          style={{
            fontSize: "9px",
            color: DIM,
            animation: "pulse 2.4s ease-in-out infinite",
          }}
        >
          ESTABLISHING LINK…
        </div>
      </div>
    );
  }

  if (!meQuery.data?.authenticated) {
    return <LoginScreen />;
  }

  return <Console />;
}
