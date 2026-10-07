<template>
  <div>
    <header class="header">
      <div class="header-inner">
        <div class="brand">房价走势<small>城市 · 小区历史价格查询</small></div>
        <nav class="nav">
          <router-link to="/">全国总览</router-link>
          <router-link to="/city">城市走势</router-link>
          <router-link to="/community">小区趋势</router-link>
          <router-link v-if="authed" to="/data">数据管理</router-link>
        </nav>
        <div class="auth-area">
          <a v-if="!authed" href="#" class="auth-link" @click.prevent="showLogin = true">登录</a>
          <a v-else href="#" class="auth-link" @click.prevent="logout">退出</a>
        </div>
      </div>
    </header>
    <div class="container">
      <router-view :key="$route.fullPath" />
    </div>
    <div class="footer">
      数据来源：国家统计局70城房价指数（官方真实）· 安居客城市挂牌均价（真实抓取）· 小区数据为标注的模拟示例，支持导入真实数据
      <br />前端版本 v1.3（已适配手机：导航/布局自适应，图表支持单指拖动、双指缩放、双击复位；若样式异常请 Ctrl+F5 强制刷新）
    </div>

    <div v-if="showLogin" class="login-mask" @click.self="showLogin = false">
      <div class="login-box">
        <h3>管理登录</h3>
        <div class="login-hint">登录后可使用“数据管理”功能（导入数据、刷新数据、抓取小区详情）</div>
        <input type="password" v-model="password" placeholder="请输入管理密码" @keyup.enter="doLogin" />
        <div v-if="loginErr" class="login-err">{{ loginErr }}</div>
        <div class="login-actions">
          <button class="btn" :disabled="logging" @click="doLogin">{{ logging ? '登录中…' : '登录' }}</button>
          <button class="btn btn-ghost" @click="showLogin = false">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { setToken, clearToken, getToken, post, api } from './api';

export default {
  data: () => ({ authed: false, authReady: false, showLogin: false, password: '', loginErr: '', logging: false }),
  watch: {
    $route(to) {
      if (to.path === '/data' && this.authReady && !this.authed) this.$router.push('/');
    },
  },
  async mounted() {
    if (getToken()) {
      try {
        const me = await api('/api/me');
        this.authed = !!me.valid;
        if (!this.authed) clearToken();
      } catch (e) { this.authed = false; }
    }
    this.authReady = true;
    if (this.$route.path === '/data' && !this.authed) this.$router.push('/');
  },
  methods: {
    async doLogin() {
      if (!this.password) { this.loginErr = '请输入密码'; return; }
      this.logging = true;
      this.loginErr = '';
      try {
        const d = await post('/api/login', { password: this.password });
        setToken(d.token);
        this.authed = true;
        this.showLogin = false;
        this.password = '';
      } catch (e) {
        this.loginErr = e.message;
      } finally {
        this.logging = false;
      }
    },
    async logout() {
      try { await post('/api/logout', {}); } catch (e) { /* ignore */ }
      clearToken();
      this.authed = false;
      if (this.$route.path === '/data') this.$router.push('/');
    },
  },
};
</script>
