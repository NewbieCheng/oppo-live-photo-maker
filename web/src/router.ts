import { createRouter, createWebHashHistory } from "vue-router";
import Converter from "./ConverterPage.vue";
import OppoExclusive from "./OppoExclusive.vue";

const routes = [
  { path: "/", component: Converter },
  { path: "/oppo-exclusive", component: OppoExclusive },
];

export default createRouter({
  history: createWebHashHistory(),
  routes,
});
