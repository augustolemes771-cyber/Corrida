# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Motoristas de aplicativo** (Uber, 99) de Caldas Novas e região, começando pelo grupo de motoristas do Augusto. Trabalham muito de madrugada, buscando gente saindo de festa. Usam o app pelo celular, quase sempre com o carro parado entre corridas. Querem ganhar seguidores, gorjetas e contatos sem quebrar as regras da Uber.
- **Passageiros**, no banco de trás e à noite, muitas vezes depois de beber. Abrem o perfil do motorista escaneando um QR ou encostando o celular numa etiqueta NFC. Ficam poucos minutos, não instalam nada e não criam conta.
- **Dono da plataforma** (Augusto, `augusto7cn`): administra as vagas do Spotify, os motoristas e as respostas do questionário.

## Product Purpose

Driver Hub é a área do motorista de aplicativo: cada motorista tem um perfil público, parecido com o de uma rede social, que ele passa ao passageiro por QR ou NFC. Nesse perfil o passageiro escolhe a música do carro, dá gorjeta por Pix, chama o motorista no WhatsApp, segue no Instagram e vê informações sobre ele. O motorista personaliza o visual e escolhe quais funções aparecem. Depois entram ferramentas para o motorista: desempenho das corridas, informações e indicações de empresas.

O sucesso é o passageiro escanear e usar o perfil durante a corrida, e o motorista ganhar seguidores, gorjetas e contatos a partir disso.

## Positioning

É um perfil do motorista feito para uso dentro do carro, e não um link na bio. O passageiro vira "DJ da corrida", controlando o Spotify do motorista na hora, e esse é o motivo dele escanear. O resto (Pix, Instagram, WhatsApp) vem junto.

## Operating Context

- Usado à noite e de madrugada, num carro escuro. O passageiro chega pelo QR na tela do celular do motorista, por um cartão no encosto do banco ou por um adesivo NFC.
- O motorista usa o painel pelo celular (iPhone) e adiciona o site à tela inicial.
- A plataforma roda em Cloudflare Workers (D1 e KV), com o código no GitHub (`augustolemes771-cyber/Corrida`) e deploy automático. O endereço atual é `corrida.augusto7.workers.dev`.

## Capabilities and Constraints

- Contas de motorista com usuário e senha. O perfil público fica em `/<usuario>`, e a raiz `/` mostra o perfil do Augusto, porque os QRs já impressos apontam para ela.
- Módulos que o motorista liga, desliga e reordena: música, Pix, WhatsApp, Instagram, links e questionário. A aba de perfil mostra foto, nome, cidade, carro, desde quando dirige, bio e comodidades.
- Música:
  - **Controle total** pelo Spotify Web API, só para contas Premium. O modo de desenvolvimento do Spotify aceita 5 contas por app.
  - O app do Augusto tem 4 vagas grátis para motoristas. A partir do 5º, o motorista fala com o Augusto no WhatsApp para desbloquear (por exemplo, no app da mãe dele, que é a dona real daquele app). Cada liberação exige adicionar o e-mail à mão no painel da Spotify.
  - Sem vaga, o motorista fica no **modo pedidos**: o passageiro busca pela API do iTunes, e o motorista abre o pedido no Spotify, no YouTube Music, no Apple Music ou no Deezer.
- O YouTube Music não tem API de controle, e o Bluetooth do carro não pode ser controlado pelo navegador.
- A Uber não permite combinar corrida por fora da plataforma. O WhatsApp serve para contato e divulgação, nunca para oferecer corrida mais barata.
- LGPD: o número do passageiro só é pedido no questionário, e com a finalidade explicada.
- Não se pode vender acesso à API do Spotify no modo de desenvolvimento.

## Brand Commitments

- Nome: **Driver Hub**.
- O Augusto aprovou para o perfil dele: visual noturno azul-escuro com âmbar, títulos condensados tipo pôster, foto de lobo apagada no fundo (`public/lobo.jpg`) e nada com "cara de IA". Ele rejeitou uma versão rosa e roxa por achá-la "muito feminina".
- Voz em português do Brasil, informal e direta ("O som é seu", "Bota a sua", "Curtiu? Manda um Pix").

## Evidence on Hand

- Ainda não há usuários além do Augusto, nem depoimentos ou números. Não inventar.
- Respostas reais do questionário estão no KV e são migradas para o D1.

## Product Principles

1. O passageiro resolve tudo em segundos, no escuro, com uma mão e sem criar conta.
2. O motorista nunca precisa mexer em código ou no Cloudflare: tudo se faz pelo painel no celular.
3. Seguir as regras da Uber e da Spotify, e ser honesto sobre os limites delas.
4. Cada motorista tem a sua cara: o visual e os módulos são dele.

## Accessibility & Inclusion

- Contraste alto e alvos de toque grandes, para uso no escuro e com o carro em movimento (passageiro).
- O QR é exibido sobre fundo branco para qualquer câmera ler.
