require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionFlagsBits,
  ChannelType,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");

const fs = require("fs");

// ─────────────────────────────────────────
//  환경 변수
// ─────────────────────────────────────────
const TOKEN     = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID  = process.env.GUILD_ID;

// ─────────────────────────────────────────
//  상수
// ─────────────────────────────────────────
const UPDATE_INTERVAL_MS = 5 * 60 * 1000;
const DATA_FILE          = "./data.json";
const WEAO_API           = "https://weao.xyz/api/status/exploits";
const WEAO_HEADERS       = { "User-Agent": "WEAO-3PService" };

// 스크린샷과 동일한 그룹별 구분
const TRACKED = {
  windowsPaid: ["Potassium", "Wave", "Seliware", "Volt", "SirHurt", "Synapse Z", "Cosmic"],
  windowsFree: ["Velocity", "Xeno", "Solara", "Madium"],
  macPaid:     ["MacSploit"],
  macFree:     ["Opiumware"]
};

// ─────────────────────────────────────────
//  데이터 저장/불러오기
// ─────────────────────────────────────────
function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return { channelId: null, messageId: null }; }
}
function saveData(d) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}

let data = loadData();

// ─────────────────────────────────────────
//  슬래시 커맨드 등록
// ─────────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName("set-channel")
    .setDescription("익스플로잇 상태를 올릴 일반 텍스트 채널을 설정합니다 (관리자 전용)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(o =>
      o.setName("channel")
       .setDescription("상태를 올릴 일반 텍스트 채널")
       .setRequired(true)
    )
    .toJSON(),

  new SlashCommandBuilder()
    .setName("update-now")
    .setDescription("익스플로잇 상태를 지금 즉시 갱신합니다 (관리자 전용)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
];

// ─────────────────────────────────────────
//  WEAO API + Embed
// ─────────────────────────────────────────
async function fetchExploits() {
  const res = await fetch(WEAO_API, { headers: WEAO_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function statusEmoji(e) {
  if (!e)              return "⚫";
  if (!e.updateStatus) return "🔴";
  return "🟢";
}

function exploitLine(e, name, isPaid) {
  const emoji = statusEmoji(e);
  const url = e?.websitelink || "https://weao.xyz";
  const linkText = `[바로가기](${url})`;
  const typeText = isPaid ? " / {유료}" : "";
  return `• **${name}**${typeText}: ${linkText} ${emoji}`;
}

function buildEmbed(allData) {
  const map = {};
  for (const item of allData) map[item.title.toLowerCase()] = item;

  // Windows
  const winPaidLines = TRACKED.windowsPaid.map(n => exploitLine(map[n.toLowerCase()], n, true));
  const winFreeLines = TRACKED.windowsFree.map(n => exploitLine(map[n.toLowerCase()], n, false));
  
  // Mac
  const macPaidLines = TRACKED.macPaid.map(n => exploitLine(map[n.toLowerCase()], n, true));
  const macFreeLines = TRACKED.macFree.map(n => exploitLine(map[n.toLowerCase()], n, false));

  // 스크린샷과 동일한 포맷의 텍스트 구성
  const description = [
    "**Windows [윈도우]**",
    "",
    ...winPaidLines,
    "",
    ...winFreeLines,
    "",
    "---------------------------------------------",
    "",
    "**Mac [맥]**",
    "",
    ...macPaidLines,
    "",
    ...macFreeLines,
    "",
    "온라인 여부 확인하러 가기: [weao.xyz](https://weao.xyz)"
  ].join("\n");

  return new EmbedBuilder()
    .setDescription(description)
    .setColor(0x2b2d31); // 디스코드 기본 어두운 임베드 색상
}

// ─────────────────────────────────────────
//  임베드 전송 / 수정
// ─────────────────────────────────────────
async function postOrUpdate() {
  if (!data.channelId) return; // 채널 미설정이면 건너뜀

  let channel;
  try {
    channel = await client.channels.fetch(data.channelId);
  } catch (err) {
    console.error("채널 불러오기 실패:", err.message);
    return;
  }

  if (!channel || !channel.isTextBased()) {
    console.error("설정된 채널이 메시지를 보낼 수 있는 텍스트 채널이 아닙니다.");
    return;
  }

  const allData = await fetchExploits();
  const embed   = buildEmbed(allData);

  // 기존 메시지가 있으면 수정
  if (data.messageId) {
    try {
      const msg = await channel.messages.fetch(data.messageId);
      await msg.edit({ embeds: [embed] });
      console.log(`[${new Date().toLocaleTimeString("ko-KR")}] ✅ 임베드 수정 완료`);
      return;
    } catch {
      // 메시지를 찾을 수 없는 경우 새로 생성하도록 id 초기화
      data.messageId = null;
    }
  }

  // 메시지가 없거나 수정 실패 시 새로 전송
  const newMsg = await channel.send({ embeds: [embed] });
  data.messageId = newMsg.id;
  saveData(data);
  console.log(`✅ 새 임베드 전송 완료 (메시지 ID: ${newMsg.id})`);
}

// ─────────────────────────────────────────
//  Discord 클라이언트
// ─────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on("error", err => console.error("[Discord 에러]", err.message));
process.on("unhandledRejection", err => console.error("[오류]", err?.message ?? err));

// ─────────────────────────────────────────
//  슬래시 커맨드 핸들러
// ─────────────────────────────────────────
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // /set-channel
  if (interaction.commandName === "set-channel") {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator))
      return interaction.reply({ content: "❌ 관리자만 사용할 수 있습니다.", ephemeral: true });

    const ch = interaction.options.getChannel("channel");
    if (!ch.isTextBased() || ch.type === ChannelType.GuildForum)
      return interaction.reply({ content: "❌ **일반 텍스트 채널**만 선택할 수 있습니다.", ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    // 채널 바뀌면 메시지 ID 초기화
    if (data.channelId !== ch.id) {
      data = { channelId: ch.id, messageId: null };
      saveData(data);
    }

    try {
      await postOrUpdate();
      await interaction.editReply(`✅ <#${ch.id}> 채널로 설정 완료! 상태판이 생성되었습니다.`);
    } catch (err) {
      await interaction.editReply(`❌ 전송 실패: ${err.message}`);
    }
    return;
  }

  // /update-now
  if (interaction.commandName === "update-now") {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator))
      return interaction.reply({ content: "❌ 관리자만 사용할 수 있습니다.", ephemeral: true });

    if (!data.channelId)
      return interaction.reply({ content: "❌ 먼저 `/set-channel`로 채널을 설정해 주세요.", ephemeral: true });

    await interaction.deferReply({ ephemeral: true });
    try {
      await postOrUpdate();
      await interaction.editReply("✅ 상태가 즉시 갱신됐습니다.");
    } catch (err) {
      await interaction.editReply(`❌ 갱신 실패: ${err.message}`);
    }
    return;
  }
});

// ─────────────────────────────────────────
//  봇 시작
// ─────────────────────────────────────────
client.once("clientReady", async () => {
  const botClientId = client.user.id;
  console.log(`✅ 봇 온라인: ${client.user.tag} (ID: ${botClientId})`);

  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    const joinedGuilds = await client.guilds.fetch();
    const isBotInTargetGuild = joinedGuilds.has(GUILD_ID);

    let route;
    if (GUILD_ID) {
      if (isBotInTargetGuild) {
        console.log(`[시작] 지정된 서버에 슬래시 커맨드 즉시 등록 중... (서버 ID: ${GUILD_ID})`);
        route = Routes.applicationGuildCommands(botClientId, GUILD_ID);
      } else {
        console.warn(`⚠️ 경고: .env에 입력된 서버 ID(${GUILD_ID})에 봇이 들어있지 않습니다. 글로벌 등록으로 진행합니다.`);
        route = Routes.applicationCommands(botClientId);
      }
    } else if (joinedGuilds.size > 0) {
      const firstGuildId = joinedGuilds.first().id;
      console.log(`[시작] 첫 번째 서버에 슬래시 커맨드 즉시 등록 중... (서버 ID: ${firstGuildId})`);
      route = Routes.applicationGuildCommands(botClientId, firstGuildId);
    } else {
      route = Routes.applicationCommands(botClientId);
    }
    
    await rest.put(route, { body: commands });
    console.log(`슬래시 커맨드 등록 완료! /set-channel 로 채널을 설정하세요.`);
  } catch (err) {
    console.error("❌ 슬래시 커맨드 등록 중 오류 발생:", err.message);
  }

  // 채널 설정돼있으면 바로 갱신 시작
  if (data.channelId) {
    postOrUpdate().catch(err => console.error("[오류]", err.stack));
  }

  // 5분마다 자동 갱신
  setInterval(() => {
    postOrUpdate().catch(err => console.error("[오류]", err.stack));
  }, UPDATE_INTERVAL_MS);
});

client.login(TOKEN);
