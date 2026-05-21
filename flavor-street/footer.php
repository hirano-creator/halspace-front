<!-- ==============================
     フッター
     ============================== -->
<footer class="fs-footer">
	<!-- CTA バナー -->
	<section class="fs-footer-cta">
		<div class="fs-container">
			<div class="fs-footer-cta__inner">
				<h2 class="fs-footer-cta__title">キッチンカーで、あなたの街をもっと豊かに</h2>
				<p class="fs-footer-cta__text">出展・誘致のご相談はお気軽にお問い合わせください</p>
				<div class="fs-footer-cta__buttons">
					<a href="<?php echo esc_url( home_url( '/exhibit/' ) ); ?>" class="fs-btn fs-btn--primary fs-btn--large">
						出展したい方はこちら
						<span class="fs-btn__arrow">&rarr;</span>
					</a>
					<a href="<?php echo esc_url( home_url( '/invite/' ) ); ?>" class="fs-btn fs-btn--accent fs-btn--large">
						誘致したい方はこちら
						<span class="fs-btn__arrow">&rarr;</span>
					</a>
				</div>
			</div>
		</div>
	</section>

	<!-- フッターメイン -->
	<div class="fs-footer__main">
		<div class="fs-container">
			<div class="fs-footer__grid">
				<!-- ロゴ・概要 -->
				<div class="fs-footer__brand">
					<?php if ( has_custom_logo() ) : ?>
						<?php the_custom_logo(); ?>
					<?php else : ?>
						<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="fs-footer__logo-text">
							<?php bloginfo( 'name' ); ?>
						</a>
					<?php endif; ?>
					<p class="fs-footer__description"><?php bloginfo( 'description' ); ?></p>

					<!-- SNSリンク -->
					<div class="fs-footer__social">
						<?php
						$socials = array(
							'twitter'   => array( 'label' => 'X', 'icon' => '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>' ),
							'instagram' => array( 'label' => 'Instagram', 'icon' => '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none"/></svg>' ),
							'facebook'  => array( 'label' => 'Facebook', 'icon' => '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>' ),
							'line'      => array( 'label' => 'LINE', 'icon' => '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/></svg>' ),
							'youtube'   => array( 'label' => 'YouTube', 'icon' => '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>' ),
						);

						foreach ( $socials as $key => $social ) :
							$url = get_theme_mod( "fs_social_{$key}" );
							if ( $url ) :
						?>
							<a href="<?php echo esc_url( $url ); ?>" class="fs-footer__social-link" target="_blank" rel="noopener noreferrer" aria-label="<?php echo esc_attr( $social['label'] ); ?>">
								<?php echo $social['icon']; ?>
							</a>
						<?php
							endif;
						endforeach;
						?>
					</div>
				</div>

				<!-- メニュー -->
				<div class="fs-footer__nav">
					<h4 class="fs-footer__nav-title">サービス</h4>
					<ul class="fs-footer__nav-list">
						<li><a href="<?php echo esc_url( home_url( '/exhibit/' ) ); ?>">キッチンカーで出展したい</a></li>
						<li><a href="<?php echo esc_url( home_url( '/start/' ) ); ?>">キッチンカーを始めたい</a></li>
						<li><a href="<?php echo esc_url( home_url( '/invite/' ) ); ?>">キッチンカーを呼びたい</a></li>
						<li><a href="<?php echo esc_url( home_url( '/event/' ) ); ?>">イベントに呼びたい</a></li>
					</ul>
				</div>

				<div class="fs-footer__nav">
					<h4 class="fs-footer__nav-title">企業情報</h4>
					<ul class="fs-footer__nav-list">
						<li><a href="<?php echo esc_url( home_url( '/about/' ) ); ?>">私たちについて</a></li>
						<li><a href="<?php echo esc_url( home_url( '/news/' ) ); ?>">ニュース</a></li>
						<li><a href="<?php echo esc_url( home_url( '/cases/' ) ); ?>">実績</a></li>
						<li><a href="<?php echo esc_url( home_url( '/contact/' ) ); ?>">お問い合わせ</a></li>
					</ul>
				</div>

				<!-- ウィジェット -->
				<div class="fs-footer__widgets">
					<?php if ( is_active_sidebar( 'footer-1' ) ) : ?>
						<?php dynamic_sidebar( 'footer-1' ); ?>
					<?php endif; ?>
				</div>
			</div>
		</div>
	</div>

	<!-- コピーライト -->
	<div class="fs-footer__bottom">
		<div class="fs-container">
			<div class="fs-footer__bottom-inner">
				<p class="fs-footer__copyright">&copy; <?php echo date( 'Y' ); ?> <?php bloginfo( 'name' ); ?>. All Rights Reserved.</p>
				<div class="fs-footer__legal">
					<a href="<?php echo esc_url( home_url( '/privacy-policy/' ) ); ?>">プライバシーポリシー</a>
					<a href="<?php echo esc_url( home_url( '/terms/' ) ); ?>">利用規約</a>
					<a href="<?php echo esc_url( home_url( '/tokushoho/' ) ); ?>">特定商取引法に基づく表記</a>
				</div>
			</div>
		</div>
	</div>
</footer>

<!-- トップへ戻るボタン -->
<button class="fs-back-to-top" id="fs-back-to-top" aria-label="ページトップへ戻る">
	<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>
</button>

<?php wp_footer(); ?>
</body>
</html>
