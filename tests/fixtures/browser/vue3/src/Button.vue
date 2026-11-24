<script>
export default {
  name: "ThrowButton",
  methods: {
    boom() {
      throw new Error("vue handler blew up");
    },
  },
};
</script>

<template>
  <button id="vue-throw" type="button" @click="boom">Vue throw</button>
</template>
