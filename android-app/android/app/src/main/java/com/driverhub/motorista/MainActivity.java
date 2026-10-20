package com.driverhub.motorista;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Modo online nativo (localização em segundo plano)
        registerPlugin(RastreioPlugin.class);
        super.onCreate(savedInstanceState);

        // Botão voltar: a página decide primeiro (window.dhVoltar).
        // 1 = já tratou (fechou menu ou voltou de aba); 2 = está na tela inicial, minimiza;
        // qualquer outra coisa = volta a página anterior, ou minimiza se não houver.
        // Minimizar em vez de fechar mantém o motorista online.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView web = getBridge().getWebView();
                web.evaluateJavascript("(function(){try{return window.dhVoltar?window.dhVoltar():0}catch(e){return 0}})()", value -> {
                    if ("1".equals(value)) return;
                    if (!"2".equals(value) && web.canGoBack()) web.goBack();
                    else moveTaskToBack(true);
                });
            }
        });
    }
}
