// redux/store.ts
/**
 * store.ts
 *
 * Redux store configuration for the timeline editor.
 */
import { configureStore } from "@reduxjs/toolkit";
import timelineReducer from "./timelineSlice";

export const store = configureStore({
  reducer: {
    timeline: timelineReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
