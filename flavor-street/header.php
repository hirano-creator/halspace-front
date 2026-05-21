<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta name="format-detection" content="telephone=no">
	<?php wp_head(); ?>
</head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>

<!-- ==============================
     ヘッダー
     ============================== -->
<header class="fs-header" id="fs-header">
	<div class="fs-header__inner fs-container">
		<!-- ロゴ -->
		<div class="fs-header__logo">
			<?php if ( has_custom_logo() ) : ?>
				<?php the_custom_logo(); ?>
			<?php else : ?>
				<a href="<?php echo esc_url( home_url( '/' ) ); ?>" class="fs-header__logo-text">
					<?php bloginfo( 'name' ); ?>
				</a>
			<?php endif; ?>
		</div>

		<!-- ナビゲーション -->
		<nav class="fs-header__nav" id="fs-nav">
			<?php
			wp_nav_menu( array(
				'theme_location' => 'primary',
				'container'      => false,
				'menu_class'     => 'fs-header__menu',
				'fallback_cb'    => 'flavor_street_fallback_menu',
			) );
			?>
		</nav>

		<!-- ヘッダーCTA -->
		<div class="fs-header__cta">
			<a href="<?php echo esc_url( home_url( '/exhibit/' ) ); ?>" class="fs-btn fs-btn--primary fs-btn--header">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
				出展したい方
			</a>
			<a href="<?php echo esc_url( home_url( '/contact/' ) ); ?>" class="fs-btn fs-btn--secondary fs-btn--header">
				お問い合わせ
			</a>
		</div>

		<!-- ハンバーガーメニュー -->
		<button class="fs-header__hamburger" id="fs-hamburger" aria-label="メニューを開く" aria-expanded="false">
			<span></span>
			<span></span>
			<span></span>
		</button>
	</div>
</header>

<!-- モバイルメニュー -->
<div class="fs-mobile-menu" id="fs-mobile-menu">
	<div class="fs-mobile-menu__inner">
		<?php
		wp_nav_menu( array(
			'theme_location' => 'mobile',
			'container'      => false,
			'menu_class'     => 'fs-mobile-menu__list',
			'fallback_cb'    => 'flavor_street_fallback_menu',
		) );
		?>
		<div class="fs-mobile-menu__cta">
			<a href="<?php echo esc_url( home_url( '/exhibit/' ) ); ?>" class="fs-btn fs-btn--primary fs-btn--large">出展したい方</a>
			<a href="<?php echo esc_url( home_url( '/invite/' ) ); ?>" class="fs-btn fs-btn--accent fs-btn--large">誘致したい方</a>
			<a href="<?php echo esc_url( home_url( '/contact/' ) ); ?>" class="fs-btn fs-btn--secondary fs-btn--large">お問い合わせ</a>
		</div>
	</div>
</div>

<?php
/**
 * メニュー未設定時のフォールバック
 */
function flavor_street_fallback_menu() {
	echo '<ul class="fs-header__menu">';
	echo '<li><a href="' . esc_url( home_url( '/' ) ) . '">TOP</a></li>';
	echo '<li><a href="#services">サービス</a></li>';
	echo '<li><a href="#about">私たちについて</a></li>';
	echo '<li><a href="#cases">実績</a></li>';
	echo '<li><a href="' . esc_url( home_url( '/news/' ) ) . '">ニュース</a></li>';
	echo '<li><a href="' . esc_url( home_url( '/contact/' ) ) . '">お問い合わせ</a></li>';
	echo '</ul>';
}
?>
