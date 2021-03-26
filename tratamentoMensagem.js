//REQUERINDO MODULOS
const fs = require('fs-extra')
const moment = require('moment-timezone')
const color = require('./lib/color')
const cadastrarGrupo = require('./lib/cadastrarGrupo')
const db = require('./lib/database')
const {botInfoUpdate, botLimitarComando, botInfo, botVerificarExpiracaoLimite,botLimitarMensagensPv} = require("./lib/bot")
const {verificarBloqueioGlobal, verificarBloqueioGrupo} = require("./lib/bloqueioComandos")

//COMANDOS
const lista_comandos = JSON.parse(fs.readFileSync('./comandos/comandos.json'))
const grupo = require('./comandos/grupo'), utilidades = require('./comandos/utilidades'), diversao = require('./comandos/diversao'), admin = require('./comandos/admin'), info = require('./comandos/info'), figurinhas = require('./comandos/figurinhas'), downloads = require('./comandos/downloads')
const { criarTexto, guiaComandoMsg, removerNegritoComando, consoleErro } = require('./lib/util')
const msgs_texto = require('./lib/msgs')

module.exports = tratamentoMensagem = async (client, message) => {
    try {
        const {t, sender, isGroupMsg, chat, type, caption, id, from, body} = message
        const {formattedTitle} = chat, { pushname, verifiedName, formattedName } = sender, username = pushname || verifiedName || formattedName
        const commands = caption || body || ''
        var command = commands.toLowerCase().split(' ')[0] || ''
        command = removerNegritoComando(command)
        const args =  commands.split(' ')
        const ownerNumber = process.env.NUMERO_DONO.trim()
        const isOwner = ownerNumber == sender.id.replace(/@c.us/g, '')
        const groupId = isGroupMsg ? chat.groupMetadata.id : ''
        const groupAdmins = isGroupMsg ? await client.getGroupAdmins(groupId) : ''
        const isGroupAdmins = isGroupMsg ? groupAdmins.includes(sender.id) : false
        const grupoInfo = isGroupMsg ? await db.obterGrupo(groupId) : ''
        const msgGuia = (args.length == 1) ? false : args[1] == "guia"
        const time = moment(t * 1000).format('DD/MM HH:mm:ss')
        const blockedNumbers = await client.getBlockedIds()
        const isBlocked = blockedNumbers.includes(sender.id)
        const comandoExiste = (
            lista_comandos.utilidades.includes(command) ||
            lista_comandos.grupo.includes(command) || 
            lista_comandos.diversao.includes(command) ||
            lista_comandos.admin.includes(command) ||
            lista_comandos.info.includes(command) ||
            lista_comandos.figurinhas.includes(command) ||
            lista_comandos.downloads.includes(command)
        )
       
        //1.0 SE O GRUPO NÃO FOR CADASTRADO
        if(isGroupMsg && !grupoInfo) await cadastrarGrupo(message,"msg",client)

        //2.0 - SE NÃO FOR MENSAGEM DE GRUPO E FOR  BLOQUEADO RETORNE
        if (!isGroupMsg && isBlocked) return

        //3.0- SE O CONTADOR TIVER ATIVADO E FOR UMA MENSAGEM DE GRUPO, VERIFICA SE O USUARIO EXISTE NO CONTADOR , REGISTRA ELE E ADICIONA A CONTAGEM
        if(isGroupMsg && grupoInfo.contador.status) {
            await db.existeUsuarioContador(groupId,sender.id)
            await db.addContagem(groupId,sender.id,type)
        }

        //4.0 - SE FOR ALGUM COMANDO EXISTENTE
        if(comandoExiste){
            let registrado = await db.verificarRegistro(sender.id)
            //4.0.1 - SE O USUARIO NÃO FOR REGISTRADO, FAÇA O REGISTRO
            if(!registrado) {
                if(isOwner) {
                    await db.verificarDonoAtual(sender.id)
                    await db.registrarDono(sender.id, username)
                }
                else {
                    await db.registrarUsuarioComum(sender.id, username)
                }
            } else {
                if(isOwner) await db.verificarDonoAtual(sender.id)       
            }

            //4.0.2 - ATUALIZE NOME DO USUÁRIO 
            await db.atualizarNome(sender.id, username)

            //4.0.3 - SE FOR MENSAGEM DE GRUPO E USUARIO FOR BLOQUEADO RETORNE
            if (isGroupMsg && isBlocked) {
                return
            }

            //4.0.4 - SE O GRUPO ESTIVER COM O RECURSO 'MUTADO' LIGADO E USUARIO NÃO FOR ADMINISTRADOR
            if(isGroupMsg && !isGroupAdmins && grupoInfo.mutar) return
            
            //4.0.5 - LIMITACAO DE COMANDO POR MINUTO
            if(botInfo().limitecomandos.status){
                let usuario = await db.obterUsuario(sender.id)
                let limiteComando = await botLimitarComando(sender.id, usuario.tipo,isGroupAdmins)
                if(limiteComando.comando_bloqueado) {
                    if(limiteComando.msg != undefined) client.reply(from, limiteComando.msg, id)
                    return 
                }
            }
            


            //4.0.6 - BLOQUEIO GLOBAL DE COMANDOS
            if(await verificarBloqueioGlobal(command) && !isOwner){
                return client.reply(from, criarTexto(msgs_texto.admin.bcmdglobal.resposta_cmd_bloqueado, command), id)
            }
            
            //4.0.7 - SE FOR MENSAGEM DE GRUPO , COMANDO ESTIVER BLOQUEADO E O USUARIO NAO FOR ADMINISTRADOR DO GRUPO
            if(isGroupMsg && await verificarBloqueioGrupo(command, groupId) && !isGroupAdmins) return client.reply(from,criarTexto(msgs_texto.grupo.bcmd.resposta_cmd_bloqueado, command), id)

            //4.0.8 - SE O RECURSO DE LIMITADOR DIARIO DE COMANDOS ESTIVER ATIVADO E O COMANDO NÃO ESTIVER NA LISTA DE EXCEÇÔES/INFO/GRUPO/ADMIN
            if(botInfo().limite_diario.status){
                if(!lista_comandos.excecoes_contagem.includes(command) && !lista_comandos.admin.includes(command) && !lista_comandos.grupo.includes(command) && !lista_comandos.info.includes(command) && !msgGuia){
                    //LIMITADOR DIARIO DE COMANDOS
                    await botVerificarExpiracaoLimite()
                    let ultrapassou = await db.ultrapassouLimite(sender.id)
                    if(!ultrapassou){ // 4.0.8.1 - SE NÃO ULTRAPASSAR LIMITE DIARIO
                        await db.addContagemDiaria(sender.id) // ADICIONA CONTAGEM
                    } else { //4.0.8.2 - SE ULTRAPASSAR LIMITE DIARIO
                        return client.reply(from, criarTexto(msgs_texto.admin.limitediario.resposta_excedeu_limite, username, botInfo().limite_diario.qtd),id)
                    }
                } else {
                    await db.addContagemTotal(sender.id)
                    await botVerificarExpiracaoLimite()
                }
            } else {
                await db.addContagemTotal(sender.id)
            }
          
            //4.0.9 - ADICIONA A CONTAGEM DE COMANDOS EXECUTADOS PELO BOT
            await botInfoUpdate()

        } else { // 5.0 SE NÃO FOR UM COMANDO EXISTENTE
            //5.0.1 - SE FOR UMA MENSAGEM PRIVADA E O LIMITADOR DE MENSAGENS ESTIVER ATIVO
            if(!isGroupMsg && botInfo().limitarmensagens.status){
                let u = await db.obterUsuario(sender.id)
                let tipo_usuario_pv = u ? u.tipo : "comum"
                let limitarMensagens = await botLimitarMensagensPv(sender.id, tipo_usuario_pv)
                if(limitarMensagens.bloquear_usuario) {
                    client.sendText(sender.id, limitarMensagens.msg).then(()=>{
                        client.contactBlock(sender.id)
                    })
                    return 
                }
            }
        }

        //6.0 - APÓS TODAS AS VERIFICAÇÕES SOLICITE OS COMANDOS
        if(lista_comandos.utilidades.includes(command)){
            //UTILIDADES
            if(msgGuia) return client.reply(from, guiaComandoMsg("utilidade", command), id)
            await utilidades(client,message)
            const timestamp_pos_comando = moment.now()/1000, tempo_resposta = (timestamp_pos_comando - t)
            if (!isGroupMsg && command.startsWith('!')) console.log('\x1b[1;31m~\x1b[1;37m>', color("[PRIVADO - UTILIDADE]","#de9a07"), time, color(command), 'de', color(username), `(${color(tempo_resposta.toFixed(3)+"s")})`)
            if (isGroupMsg && command.startsWith('!')) console.log('\x1b[1;31m~\x1b[1;37m>', color("[GRUPO - UTILIDADE]","#de9a07"), time, color(command), 'de', color(username), 'em', color(formattedTitle), `(${color(tempo_resposta.toFixed(3)+"s")})`)
        } else if(lista_comandos.info.includes(command)){
            //INFO
            if(msgGuia) return client.reply(from, guiaComandoMsg("info", command), id)
            await info(client,message)
            const timestamp_pos_comando = moment.now()/1000, tempo_resposta = (timestamp_pos_comando - t)
            if (!isGroupMsg && command.startsWith('!')) console.log('\x1b[1;31m~\x1b[1;37m>', color("[PRIVADO - INFO]","#8ac46e"), time, color(command), 'de', color(username), `(${color(tempo_resposta.toFixed(3)+"s")})`)
            if (isGroupMsg && command.startsWith('!')) console.log('\x1b[1;31m~\x1b[1;37m>', color("[GRUPO - INFO]","#8ac46e"), time, color(command), 'de', color(username), 'em', color(formattedTitle), `(${color(tempo_resposta.toFixed(3)+"s")})`)
        } else if(lista_comandos.figurinhas.includes(command)){
            //FIGURINHAS
            if(msgGuia) return client.reply(from, guiaComandoMsg("figurinhas", command), id)
            await figurinhas(client,message)
            const timestamp_pos_comando = moment.now()/1000, tempo_resposta = (timestamp_pos_comando - t)
            if (!isGroupMsg && command.startsWith('!')) console.log('\x1b[1;31m~\x1b[1;37m>', color("[PRIVADO - FIGURINHAS]","#ae45d1"), time, color(command), 'de', color(username), `(${color(tempo_resposta.toFixed(3)+"s")})`)
            if (isGroupMsg && command.startsWith('!')) console.log('\x1b[1;31m~\x1b[1;37m>', color("[GRUPO - FIGURINHAS]","#ae45d1"), time, color(command), 'de', color(username), 'em', color(formattedTitle), `(${color(tempo_resposta.toFixed(3)+"s")})`)
        } else if(lista_comandos.downloads.includes(command)){
            //DOWNLOADS
            if(msgGuia) return client.reply(from, guiaComandoMsg("downloads", command), id)
            await downloads(client,message)
            const timestamp_pos_comando = moment.now()/1000, tempo_resposta = (timestamp_pos_comando - t)
            if (!isGroupMsg && command.startsWith('!')) console.log('\x1b[1;31m~\x1b[1;37m>', color("[PRIVADO - DOWNLOADS]","#2195cf"), time, color(command), 'de', color(username), `(${color(tempo_resposta.toFixed(3)+"s")})`)
            if (isGroupMsg && command.startsWith('!')) console.log('\x1b[1;31m~\x1b[1;37m>', color("[GRUPO - DOWNLOADS]","#2195cf"), time, color(command), 'de', color(username), 'em', color(formattedTitle), `(${color(tempo_resposta.toFixed(3)+"s")})`)
        } else if (lista_comandos.grupo.includes(command)){
            //GRUPO
            if(msgGuia) return client.reply(from, guiaComandoMsg("grupo", command), id)
            await grupo(client,message)
            const timestamp_pos_comando = moment.now()/1000, tempo_resposta = (timestamp_pos_comando - t)
            if (isGroupMsg && command.startsWith('!')) console.log('\x1b[1;31m~\x1b[1;37m>', color("[GRUPO - ADMINISTRAÇÃO]","#e0e031"), time, color(command), 'de', color(username), 'em', color(formattedTitle), `(${color(tempo_resposta.toFixed(3)+"s")})`)
        } else if(lista_comandos.diversao.includes(command)){
            //DIVERSÃO
            if(msgGuia) return client.reply(from, guiaComandoMsg("diversao", command), id)
            await diversao(client,message)
            const timestamp_pos_comando = moment.now()/1000, tempo_resposta = (timestamp_pos_comando - t)
            if (!isGroupMsg && command.startsWith('!')) console.log('\x1b[1;31m~\x1b[1;37m>',color("[PRIVADO - DIVERSÃO]","#22e3dd"), time, color(command), 'de', color(username), `(${color(tempo_resposta.toFixed(3)+"s")})`)
            if (isGroupMsg && command.startsWith('!')) console.log('\x1b[1;31m~\x1b[1;37m>', color("[GRUPO - DIVERSÃO]","#22e3dd"), time, color(command), 'de', color(username), 'em', color(formattedTitle), `(${color(tempo_resposta.toFixed(3)+"s")})`)
        } else if(lista_comandos.admin.includes(command)){
            //ADMIN
            if(msgGuia) return client.reply(from, guiaComandoMsg("admin", command), id)
            await admin(client,message)
            const timestamp_pos_comando = moment.now()/1000, tempo_resposta = (timestamp_pos_comando - t)
            if (!isGroupMsg && command.startsWith('!')) console.log('\x1b[1;31m~\x1b[1;37m>', color("[PRIVADO - DONO]","#d1d1d1"), time, color(command), 'de', color(username), `(${color(tempo_resposta.toFixed(3)+"s")})`)
            if (isGroupMsg && command.startsWith('!')) console.log('\x1b[1;31m~\x1b[1;37m>', color("[GRUPO - DONO]","#d1d1d1"), time, color(command), 'de', color(username), 'em', color(formattedTitle), `(${color(tempo_resposta.toFixed(3)+"s")})`)
        } else {
            if(!isGroupMsg) return client.reply(from, msgs_texto.geral.comando_invalido ,id)
        }

    } catch (err) {
        consoleErro(err, 'tratamentoMensagem')
    }
}
