import { mount } from "svelte";
import App from "./App.svelte";
import "./app/styles/global.css";

mount(App, { target: document.querySelector<HTMLElement>("#app")! });
